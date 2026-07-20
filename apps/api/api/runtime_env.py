"""RepoLume environment access with compatibility for pre-rename installs."""
from __future__ import annotations

import os
import shutil
from pathlib import Path


def product_env(name: str, default: str | None = None) -> str | None:
    """Read REPOLUME_<name>, then the legacy LOCALWIKI_<name>."""
    return os.getenv(f"REPOLUME_{name}", os.getenv(f"LOCALWIKI_{name}", default))


def migrate_product_file(root: Path, current_name: str, legacy_name: str) -> Path:
    """Copy a pre-rename data file once, preserving the legacy file as rollback."""
    current = root / current_name
    legacy = root / legacy_name
    if not current.exists() and legacy.is_file():
        root.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy, current)
    return current
