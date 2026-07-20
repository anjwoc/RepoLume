"""Filesystem endpoints: folder picker and local repo structure scanner."""
import json
import logging
import os
import platform
import subprocess

import yaml
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter()

_PREFLIGHT_SKIP_DIRS = {
    ".git", ".hg", ".svn", ".venv", "__pycache__", "node_modules",
    "dist", "build", "out", "coverage", "vendor",
}


def _raise_walk_error(error: OSError) -> None:
    raise error


def probe_folder_access(path: str) -> dict[str, object]:
    if not os.path.isdir(path):
        raise NotADirectoryError(path)

    directories_checked = 0
    files_checked = 0
    symlinks_skipped = 0

    # A shallow scandir can succeed before macOS encounters a protected nested
    # location. Walk the same project tree the analysis workers will consume and
    # read one real file per directory so TCC prompts happen during preflight.
    for root, dirs, files in os.walk(
        path,
        topdown=True,
        onerror=_raise_walk_error,
        followlinks=False,
    ):
        directories_checked += 1

        traversable_dirs: list[str] = []
        for dirname in dirs:
            full_path = os.path.join(root, dirname)
            if os.path.islink(full_path):
                symlinks_skipped += 1
                continue
            if dirname in _PREFLIGHT_SKIP_DIRS:
                continue
            traversable_dirs.append(dirname)
        dirs[:] = traversable_dirs

        for filename in files:
            full_path = os.path.join(root, filename)
            if os.path.islink(full_path):
                symlinks_skipped += 1
                continue
            if not os.path.isfile(full_path):
                continue
            with open(full_path, "rb") as file_handle:
                file_handle.read(1)
            files_checked += 1
            break

    return {
        "readable": True,
        "name": os.path.basename(os.path.normpath(path)) or path,
        "error": None,
        "directories_checked": directories_checked,
        "files_checked": files_checked,
        "symlinks_skipped": symlinks_skipped,
    }


@router.get("/api/fs/probe")
def probe_folder(path: str = Query(...)):
    try:
        return probe_folder_access(path)
    except NotADirectoryError:
        return JSONResponse(
            status_code=404,
            content={"readable": False, "name": os.path.basename(path), "error": "Folder not found"},
        )
    except PermissionError as error:
        return JSONResponse(
            status_code=403,
            content={"readable": False, "name": os.path.basename(path), "error": str(error)},
        )
    except OSError as error:
        return JSONResponse(
            status_code=500,
            content={"readable": False, "name": os.path.basename(path), "error": str(error)},
        )


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


_LOCAL_WIKI_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@router.get("/api/catalog")
async def get_catalog(path: str = Query(None)):
    """Return flows from flows/catalog.yaml (analyzed project first, then local-wiki root)."""
    candidates = []
    if path:
        candidates.append(os.path.join(path, "flows", "catalog.yaml"))
    candidates.append(os.path.join(_LOCAL_WIKI_ROOT, "flows", "catalog.yaml"))

    for catalog_path in candidates:
        if os.path.isfile(catalog_path):
            try:
                with open(catalog_path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                flows = data.get("flows", []) if data else []
                items = []
                for fl in flows:
                    item = {"id": fl["id"], "name": fl["name"]}
                    if "diagramDataFile" in fl:
                        item["diagramDataFile"] = fl["diagramDataFile"]
                    items.append(item)
                return {"flows": items}
            except Exception as e:
                logger.error(f"Error reading catalog {catalog_path}: {e}")
                return JSONResponse(status_code=500, content={"error": str(e)})

    return JSONResponse(status_code=404, content={"flows": []})


@router.get("/api/catalog/detail")
async def get_catalog_detail(flowId: str, path: str = Query(None)):
    """Return edge step data for a specific flow from flows/{flowId}.steps.json."""
    candidates = []
    if path:
        candidates.append(os.path.join(path, "flows", f"{flowId}.steps.json"))
    candidates.append(os.path.join(_LOCAL_WIKI_ROOT, "flows", f"{flowId}.steps.json"))

    for steps_path in candidates:
        if os.path.isfile(steps_path):
            try:
                with open(steps_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error reading steps {steps_path}: {e}")
                return JSONResponse(status_code=500, content={"error": str(e)})

    return JSONResponse(status_code=404, content={"error": f"No steps file for {flowId}"})
