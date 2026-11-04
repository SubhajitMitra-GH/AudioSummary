# PyInstaller build for the desktop backend. Run via scripts/build-desktop.sh
# (or: cd backend && .venv/bin/pyinstaller --noconfirm backend-service.spec).
# Produces backend/dist/backend-service/backend-service, which electron-builder copies into the app.
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []

# Packages that load data files, native libraries or plugins dynamically.
for pkg in (
    "faster_whisper",          # Silero VAD model asset
    "ctranslate2",             # Whisper inference library (native)
    "onnxruntime",             # used by faster-whisper's VAD
    "tokenizers",
    "sentence_transformers",
    "transformers",
    "huggingface_hub",
    "yt_dlp",                  # extractors are imported by name at runtime
    "certifi",                 # CA bundle for HTTPS (Supabase, Hugging Face, yt-dlp)
):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("langchain_community.llms")
hiddenimports += collect_submodules("langchain_text_splitters")
hiddenimports += collect_submodules("redis")
hiddenimports += ["app.main", "jwt", "jwt.algorithms", "cryptography", "multipart", "python_multipart", "dateutil"]

a = Analysis(
    ["desktop_entry.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "IPython", "pytest", "fakeredis", "notebook"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="backend-service",
    console=True,
    upx=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="backend-service",
)
