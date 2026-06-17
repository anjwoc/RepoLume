"""Chat completion handler — orchestrates the pipeline stages."""
import asyncio
import logging
import uuid

from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from api.chat import prompt_builder, provider_dispatcher, rag_manager, validator
from api.chat.models import ChatCompletionRequest
from api.db.store import job_store
from api.events import EventType
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)


async def chat_completions_stream(request: ChatCompletionRequest):
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

        # 5. Dispatch to provider
        if request.use_cli:
            stream_gen = provider_dispatcher.cli_stream(request, prompt)
        else:
            model, model_kwargs = provider_dispatcher.create_api_model(request)
            stream_gen = provider_dispatcher.api_stream(
                model, model_kwargs, request,
                system_prompt, conversation_history, file_content, prompt, query,
            )

        # 6. Return or run in background
        if request.async_mode and request.stream_id:
            job_id = str(uuid.uuid4())
            job_store.create(job_id)

            async def background_task(gen, _job_id=job_id):
                chunk_count = 0
                try:
                    async for chunk in gen:
                        if chunk and isinstance(chunk, str):
                            chunk_count += 1
                            await emit_task_event(
                                _job_id, EventType.AGENT_CHUNK,
                                message=chunk, data={"text": chunk},
                            )
                except Exception as e_bg:
                    logger.error(f"Background stream error: {e_bg}")
                    await emit_task_event(
                        _job_id, "error", f"Background stream error: {str(e_bg)}", phase="generation"
                    )
                finally:
                    if chunk_count == 0:
                        logger.error(f"[job={_job_id}] AI가 아무 출력도 하지 않았습니다 (0 chunks).")
                        await emit_task_event(
                            _job_id, "error",
                            "AI 응답 없음: 모델이 빈 응답을 반환했습니다. 프롬프트가 너무 크거나 CLI 실행에 실패했을 수 있습니다.",
                            phase="generation",
                        )
                    await emit_task_event(_job_id, "complete", "Stream finished", phase="chat")
                    job_store.complete(_job_id, 0)

            asyncio.create_task(background_task(stream_gen))
            return JSONResponse({"status": "queued", "job_id": job_id})

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
