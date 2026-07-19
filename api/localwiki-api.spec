from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

api_root = Path(SPECPATH)
project_root = api_root.parent

datas = [
    (str(api_root / "config"), "api/config"),
    (str(api_root / "db" / "schema.sql"), "api/db"),
]
hiddenimports = collect_submodules("api") + collect_submodules("cli")
binaries = []

for package in (
    "adalflow",
    "anthropic",
    "faiss",
    "google.generativeai",
    "langid",
    "ollama",
    "openai",
    "tiktoken",
    "tiktoken_ext",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    hiddenimports += package_hiddenimports
    binaries += package_binaries

analysis = Analysis(
    [str(api_root / "desktop_entry.py")],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["matplotlib", "notebook", "pytest"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
executable = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="localwiki-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
collection = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    name="localwiki-api",
)
