"""Chat completion handler — orchestrates the pipeline stages."""
import asyncio
from contextlib import suppress
import json
import logging
import os
import time
import uuid

from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from api.background_jobs import background_jobs
from api.chat import prompt_builder, provider_dispatcher, rag_manager, validator
from api.chat.models import ChatCompletionRequest
from api.db.generation_jobs import TaskDefinition, generation_job_store
from api.db.store import job_store
from api.events import EventType
from api.task_streams import emit_task_event
from api.runtime_env import product_env

logger = logging.getLogger(__name__)

_STREAM_HEARTBEAT_SECONDS = float(product_env("STREAM_HEARTBEAT_SECONDS", "15") or "15")
_STREAM_IDLE_TIMEOUT_SECONDS = float(product_env("STREAM_IDLE_TIMEOUT_SECONDS", "330") or "330")


class StreamIdleTimeout(RuntimeError):
    pass


async def _pump_stream(stream_gen, queue: asyncio.Queue[tuple[str, object]]) -> None:
    try:
        async for chunk in stream_gen:
            await queue.put(("chunk", chunk))
    except asyncio.CancelledError:
        raise
    except Exception as error:
        await queue.put(("error", error))
    finally:
        await queue.put(("done", None))


async def _run_background_stream(
    stream_gen,
    job_id: str,
    generation_task_id: str,
    provider_handles_attempts: bool,
) -> None:
    started_at = time.monotonic()
    chunk_count = 0
    api_attempt = None
    producer = None
    try:
        if not provider_handles_attempts:
            api_attempt = await asyncio.to_thread(
                generation_job_store.begin_attempt,
                job_id,
                generation_task_id,
            )
        queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue()
        producer = asyncio.create_task(_pump_stream(stream_gen, queue))
        last_activity = time.monotonic()
        while True:
            idle_remaining = _STREAM_IDLE_TIMEOUT_SECONDS - (
                time.monotonic() - last_activity
            )
            if idle_remaining <= 0:
                raise StreamIdleTimeout(
                    f"Provider produced no output for {_STREAM_IDLE_TIMEOUT_SECONDS:g} seconds"
                )
            try:
                item_type, payload = await asyncio.wait_for(
                    queue.get(),
                    timeout=min(_STREAM_HEARTBEAT_SECONDS, idle_remaining),
                )
            except asyncio.TimeoutError:
                if api_attempt:
                    await asyncio.to_thread(
                        generation_job_store.record_activity,
                        api_attempt.attempt_id,
                        heartbeat=True,
                    )
                if not provider_handles_attempts:
                    await emit_task_event(
                        job_id,
                        EventType.HEARTBEAT,
                        "Provider request is active",
                        phase="generation",
                        data={"task_id": generation_task_id},
                    )
                continue

            if item_type == "error":
                raise payload
            if item_type == "done":
                await producer
                break

            chunk = payload
            if chunk and isinstance(chunk, str):
                last_activity = time.monotonic()
                chunk_count += 1
                if api_attempt:
                    await asyncio.to_thread(
                        generation_job_store.record_activity,
                        api_attempt.attempt_id,
                    )
                await emit_task_event(
                    job_id,
                    EventType.AGENT_CHUNK,
                    message=chunk,
                    data={
                        "text": chunk,
                        "task_id": generation_task_id,
                        "attempt_id": api_attempt.attempt_id if api_attempt else None,
                    },
                )
        if chunk_count == 0:
            raise RuntimeError("AI 응답 없음: 모델이 빈 응답을 반환했습니다.")
        if api_attempt:
            completed = await asyncio.to_thread(
                generation_job_store.complete_attempt,
                api_attempt.attempt_id,
                {"chunk_count": chunk_count},
            )
            if not completed:
                raise RuntimeError(
                    f"Completion rejected for inactive attempt {api_attempt.attempt_id}"
                )
        completeness = await asyncio.to_thread(
            generation_job_store.completeness,
            job_id,
        )
        if (
            not completeness["complete"]
            or completeness["succeeded"] != completeness["expected"]
        ):
            raise RuntimeError(f"Generation completeness barrier failed: {completeness}")
    except asyncio.CancelledError:
        if api_attempt:
            await asyncio.to_thread(
                generation_job_store.fail_attempt,
                api_attempt.attempt_id,
                error_code="cancelled",
                error_message="Background API execution cancelled",
                failure_status="cancelled",
                retryable=False,
            )
        await asyncio.to_thread(job_store.interrupt, job_id, "cancelled")
        await emit_task_event(job_id, "cancelled", "Stream cancelled", phase="chat")
        raise
    except Exception as error:
        logger.error("Background stream error: %s", error)
        if api_attempt:
            timed_out = isinstance(error, StreamIdleTimeout)
            await asyncio.to_thread(
                generation_job_store.fail_attempt,
                api_attempt.attempt_id,
                error_code="stream_idle_timeout" if timed_out else "provider_error",
                error_message=str(error),
                failure_status="timed_out" if timed_out else "failed",
                retryable=False,
            )
        await emit_task_event(
            job_id,
            "error",
            f"Background stream error: {str(error)}",
            phase="generation",
        )
        await asyncio.to_thread(job_store.fail, job_id, str(error))
    else:
        await emit_task_event(job_id, "complete", "Stream finished", phase="chat")
        duration_ms = int((time.monotonic() - started_at) * 1000)
        await asyncio.to_thread(job_store.complete, job_id, duration_ms)
    finally:
        if producer and not producer.done():
            producer.cancel()
            with suppress(asyncio.CancelledError):
                await producer


async def _chat_completions_stream(
    request: ChatCompletionRequest,
    *,
    existing_job_id: str | None = None,
):
    try:
        await emit_task_event(
            request.stream_id, "task_status",
            "Chat completion request received",
            phase="chat",
            data={"provider": request.provider, "model": request.model, "repo_url": request.repo_url},
        )

        # 1. Validate message structure and input size
        if not request.messages:
            raise HTTPException(status_code=400, detail="No messages provided")
        if request.messages[-1].role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from the user")
        input_too_large = await validator.check_input_size(request)

        # 2. Prepare RAG
        rag = await rag_manager.prepare_rag(request)
        rag_manager.add_conversation_history(rag, request.messages[:-1])

        # 3. Retrieve context
        context_text = await rag_manager.retrieve_context(rag, request, input_too_large)
        if not context_text and not input_too_large and not request.skip_rag:
            await emit_task_event(
                request.stream_id, "task_status",
                "Answering without retrieval augmentation", phase="rag",
            )

        # 4. Detect deep research, build prompt
        is_deep_research, research_iteration = prompt_builder.detect_deep_research(request.messages)
        system_prompt = prompt_builder.build_system_prompt(request, is_deep_research, research_iteration)
        conversation_history = rag_manager.get_conversation_history(rag)
        file_content = prompt_builder.load_file_content(request)
        query = request.messages[-1].content

        # Handle deep research continuation — replace "continue" with the original topic
        if is_deep_research:
            logger.info(f"Deep Research request detected — iteration {research_iteration}")
            if "continue" in query.lower() and "research" in query.lower():
                for msg in request.messages:
                    if msg.role == "user" and "continue" not in msg.content.lower():
                        original_topic = msg.content.replace("[DEEP RESEARCH]", "").strip()
                        logger.info(f"Using original topic for research: {original_topic}")
                        query = original_topic
                        break

        prompt = prompt_builder.assemble_prompt(
            request, system_prompt, context_text, file_content, conversation_history, query
        )

        async_job_id = (
            existing_job_id
            or (str(uuid.uuid4()) if request.async_mode and request.stream_id else None)
        )
        generation_task_id = request.task_id or request.filePath or "chat"
        # 5. Dispatch to provider
        if request.use_cli:
            stream_gen = provider_dispatcher.cli_stream(
                request,
                prompt,
                generation_job_id=async_job_id,
                generation_task_id=generation_task_id if async_job_id else None,
                raise_on_error=bool(async_job_id),
            )
        else:
            model, model_kwargs = provider_dispatcher.create_api_model(request)
            stream_gen = provider_dispatcher.api_stream(
                model, model_kwargs, request,
                system_prompt, conversation_history, file_content, prompt, query,
                raise_on_error=bool(async_job_id),
            )

        # 6. Return or run in background
        if async_job_id:
            if existing_job_id is None:
                await asyncio.to_thread(job_store.create, async_job_id)
            await asyncio.to_thread(job_store.start, async_job_id)
            resumable_request = request.model_dump(exclude={"api_key", "token"})
            resumable_request["stream_id"] = async_job_id
            restart_safe = not request.api_key and not request.token
            await asyncio.to_thread(
                generation_job_store.register_tasks,
                async_job_id,
                [
                    TaskDefinition(
                        generation_task_id,
                        "cli" if request.use_cli else "api",
                        {
                            "provider": request.provider,
                            "model": request.model,
                            "request": resumable_request,
                        },
                        restart_safe=restart_safe,
                        max_attempts=_MAX_RESTART_ATTEMPTS,
                    )
                ],
            )
            await background_jobs.start(
                async_job_id,
                _run_background_stream(
                    stream_gen,
                    async_job_id,
                    generation_task_id,
                    provider_handles_attempts=bool(request.use_cli),
                ),
            )
            return JSONResponse({"status": "queued", "job_id": async_job_id})

        return StreamingResponse(
            stream_gen,
            media_type="text/plain" if request.use_cli else "text/event-stream",
        )

    except HTTPException:
        raise
    except Exception as e_handler:
        error_msg = f"Error in streaming chat completion: {str(e_handler)}"
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)


_MAX_RESTART_ATTEMPTS = 3


async def chat_completions_stream(request: ChatCompletionRequest):
    return await _chat_completions_stream(request)


async def resume_requeued_generation(reconciled: dict) -> bool:
    job_id = str(reconciled["job_id"])
    task_id = str(reconciled["task_id"])
    try:
        payload = json.loads(reconciled.get("payload_json") or "{}")
        request_payload = payload["request"]
        request_payload["async_mode"] = True
        request_payload["stream_id"] = job_id
        request = ChatCompletionRequest.model_validate(request_payload)
        await _chat_completions_stream(request, existing_job_id=job_id)
        await emit_task_event(
            job_id,
            "task_status",
            "Generation resumed after service restart",
            phase="recovery",
            data={"task_id": task_id, "attempt_id": reconciled.get("attempt_id")},
        )
        return True
    except Exception as error:
        message = f"Restart recovery failed: {error}"
        await asyncio.to_thread(
            generation_job_store.fail_queued_task,
            job_id,
            task_id,
            error_code="restart_recovery_failed",
            error_message=message,
        )
        await asyncio.to_thread(job_store.fail, job_id, message)
        await emit_task_event(job_id, "error", message, phase="recovery")
        logger.error("%s job=%s task=%s", message, job_id, task_id)
        return False
