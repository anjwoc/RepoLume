"""Root conftest — patch tiktoken encoding download before any api imports.

tiktoken fetches encoding files over HTTPS at import time. In corporate networks
with self-signed certs this fails. Patch get_encoding/encoding_for_model to return
a mock that approximates token counts without network access.
"""
from __future__ import annotations
import sys
from unittest.mock import MagicMock, patch


def _mock_encoding(name: str | None = None) -> MagicMock:
    enc = MagicMock()
    enc.encode.side_effect = lambda text, **kw: list(range(max(1, len(text) // 4)))
    enc.decode.side_effect = lambda tokens: " ".join(str(t) for t in tokens)
    return enc


# Patch before any api.* import happens during collection.
patch("tiktoken.get_encoding", side_effect=_mock_encoding).start()
patch("tiktoken.encoding_for_model", side_effect=_mock_encoding).start()
