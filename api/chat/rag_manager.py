"""RAG initialization, document retrieval, and conversation history management."""
import logging
from urllib.parse import unquote
from fastapi import HTTPException
from api.rag import RAG
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)


async def prepare_rag(request) -> "RAG | None":
    """Initialize and prepare RAG retriever. Returns None if skip_rag=True."""
    if request.skip_rag:
        logger.info("skip_rag=True: skipping RAG initialization entirely")
        return None

    request_rag = RAG(provider=request.provider, model=request.model)

    excluded_dirs = _parse_newline_list(request.excluded_dirs)
    excluded_files = _parse_newline_list(request.excluded_files)
    included_dirs = _parse_newline_list(request.included_dirs)
    included_files = _parse_newline_list(request.included_files)

    if excluded_dirs: logger.info(f"Using custom excluded directories: {excluded_dirs}")
    if excluded_files: logger.info(f"Using custom excluded files: {excluded_files}")
    if included_dirs:  logger.info(f"Using custom included directories: {included_dirs}")
    if included_files: logger.info(f"Using custom included files: {included_files}")

    try:
        await emit_task_event(
            request.stream_id, "phase_start", "Preparing retriever",
            phase="retriever",
            data={"repo_url": request.repo_url, "repo_type": request.type},
        )
        request_rag.prepare_retriever(
            request.repo_url, request.type, request.token,
            excluded_dirs, excluded_files, included_dirs, included_files,
        )
        logger.info(f"Retriever prepared for {request.repo_url}")
        await emit_task_event(
            request.stream_id, "phase_complete", "Retriever prepared",
            phase="retriever", data={"repo_url": request.repo_url},
        )
    except ValueError as e:
        msg = str(e)
        if "No valid documents with embeddings found" in msg:
            logger.error(f"No valid embeddings found: {msg}")
            await emit_task_event(request.stream_id, "error", "No valid document embeddings found", phase="retriever")
            raise HTTPException(status_code=500, detail="No valid document embeddings found.")
        logger.error(f"ValueError preparing retriever: {msg}")
        await emit_task_event(request.stream_id, "error", f"Error preparing retriever: {msg}", phase="retriever")
        raise HTTPException(status_code=500, detail=f"Error preparing retriever: {msg}")
    except Exception as e:
        msg = str(e)
        logger.error(f"Error preparing retriever: {msg}")
        await emit_task_event(request.stream_id, "error", f"Error preparing retriever: {msg}", phase="retriever")
        raise HTTPException(status_code=500, detail=f"Error preparing retriever: {msg}")

    return request_rag


def _parse_newline_list(value: str | None) -> list[str] | None:
    if not value:
        return None
    items = [unquote(p) for p in value.split("\n") if p.strip()]
    return items or None


async def retrieve_context(rag, request, input_too_large: bool) -> str:
    """Retrieve documents from RAG and return formatted context string."""
    if input_too_large or request.skip_rag or rag is None:
        return ""

    try:
        rag_query = request.messages[-1].content
        if request.filePath:
            rag_query = f"Contexts related to {request.filePath}"
            logger.info(f"Modified RAG query to focus on file: {request.filePath}")

        await emit_task_event(
            request.stream_id, "phase_start", "Retrieving repository context",
            phase="rag", data={"file_path": request.filePath},
        )
        retrieved_documents = rag(rag_query, language=request.language)

        if retrieved_documents and retrieved_documents[0].documents:
            documents = retrieved_documents[0].documents
            logger.info(f"Retrieved {len(documents)} documents")
            await emit_task_event(
                request.stream_id, "phase_complete",
                f"Retrieved {len(documents)} documents",
                phase="rag", data={"document_count": len(documents)},
            )
            docs_by_file: dict = {}
            for doc in documents:
                fp = doc.meta_data.get("file_path", "unknown")
                docs_by_file.setdefault(fp, []).append(doc)

            context_parts = []
            for fp, docs in docs_by_file.items():
                header = f"## File Path: {fp}\n\n"
                content = "\n\n".join(doc.text for doc in docs)
                context_parts.append(f"{header}{content}")
            return "\n\n" + "-" * 10 + "\n\n".join(context_parts)

        logger.warning("No documents retrieved from RAG")
        await emit_task_event(
            request.stream_id, "phase_complete", "No documents retrieved from RAG",
            phase="rag", data={"document_count": 0},
        )
        return ""

    except Exception as e:
        logger.error(f"Error in RAG retrieval: {str(e)}")
        await emit_task_event(request.stream_id, "error", f"Error in RAG retrieval: {str(e)}", phase="rag")
        return ""


def add_conversation_history(rag, messages: list) -> None:
    """Add prior message pairs to RAG memory."""
    if rag is None:
        return
    for i in range(0, len(messages) - 1, 2):
        if i + 1 < len(messages):
            user_msg = messages[i]
            asst_msg = messages[i + 1]
            if user_msg.role == "user" and asst_msg.role == "assistant":
                rag.memory.add_dialog_turn(
                    user_query=user_msg.content,
                    assistant_response=asst_msg.content,
                )


def get_conversation_history(rag) -> str:
    """Format RAG memory turns as a conversation history string."""
    if rag is None:
        return ""
    history = ""
    for turn_id, turn in rag.memory().items():
        if (
            not isinstance(turn_id, int)
            and hasattr(turn, "user_query")
            and hasattr(turn, "assistant_response")
        ):
            history += (
                f"<turn>\n"
                f"<user>{turn.user_query.query_str}</user>\n"
                f"<assistant>{turn.assistant_response.response_str}</assistant>\n"
                f"</turn>\n"
            )
    return history
