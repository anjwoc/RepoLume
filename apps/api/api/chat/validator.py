"""Request validation — token counting and input size guard."""
import logging
from api.data_pipeline import count_tokens
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)

_TOKEN_WARN_LIMIT = 8000
_TOKEN_RECOMMENDED_LIMIT = 7500


async def check_input_size(request) -> bool:
    """Return True if the last message is too large (>8000 tokens)."""
    if not request.messages:
        return False
    last = request.messages[-1]
    if not (hasattr(last, "content") and last.content):
        return False

    tokens = count_tokens(last.content, False)
    logger.info(f"Request size: {tokens} tokens")
    await emit_task_event(
        request.stream_id, "task_status",
        f"Request size: {tokens} tokens",
        phase="chat", data={"tokens": tokens},
    )
    if tokens > _TOKEN_WARN_LIMIT:
        logger.warning(f"Request exceeds recommended token limit ({tokens} > {_TOKEN_RECOMMENDED_LIMIT})")
        await emit_task_event(
            request.stream_id, "task_status",
            "Request exceeds recommended token limit",
            phase="chat",
            data={"tokens": tokens, "recommended_limit": _TOKEN_RECOMMENDED_LIMIT},
        )
        return True
    return False
