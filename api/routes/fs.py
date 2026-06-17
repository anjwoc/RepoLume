"""Filesystem endpoints: folder picker and local repo structure scanner."""
import logging
import os
import platform
import subprocess

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/fs/select_folder")
async def select_folder():
    """Open a native folder picker dialog and return the chosen absolute path."""
    try:
        if platform.system() == "Darwin":
            script = """
            tell application (path to frontmost application as text)
                activate
                set folderPath to choose folder with prompt "Select Project Folder"
                POSIX path of folderPath
            end tell
            """
            result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return {"path": result.stdout.strip()}
            return {"path": ""}

        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder_path = filedialog.askdirectory(title="Select Project Folder")
        root.destroy()
        return {"path": folder_path}
    except Exception as e:
        logger.error(f"Error opening folder picker: {e}")
        return {"path": ""}


@router.get("/local_repo/structure")
async def get_local_repo_structure(path: str = Query(None)):
    """Return the file tree and README content for a local repository."""
    if not path:
        return JSONResponse(status_code=400, content={"error": "No path provided."})
    if not os.path.isdir(path):
        return JSONResponse(status_code=404, content={"error": f"Directory not found: {path}"})

    try:
        _EXCLUDE_DIRS = {"__pycache__", "node_modules", ".venv", "dist", "build", "out", "coverage", "vendor"}
        file_tree_lines: list[str] = []
        readme_content = ""

        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in _EXCLUDE_DIRS]
            for file in files:
                if file.startswith(".") or file in ("__init__.py", ".DS_Store"):
                    continue
                rel_dir = os.path.relpath(root, path)
                rel_file = os.path.join(rel_dir, file) if rel_dir != "." else file
                file_tree_lines.append(rel_file)
                if file.lower() == "readme.md" and not readme_content:
                    try:
                        with open(os.path.join(root, file), "r", encoding="utf-8") as f:
                            readme_content = f.read()
                    except Exception as e:
                        logger.warning(f"Could not read README.md: {e}")

        return {"file_tree": "\n".join(sorted(file_tree_lines)), "readme": readme_content}
    except Exception as e:
        logger.error(f"Error processing local repository: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
