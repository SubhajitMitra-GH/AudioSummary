"""Entry point for the packaged desktop backend (PyInstaller).

Electron starts this binary with HOST/PORT/REDIS_* in the environment and the bundled
.env (copied from backend/desktop.env) in the working directory.
"""
import multiprocessing

if __name__ == "__main__":
    # Libraries (torch / multiprocessing's resource tracker) start helper processes by re-running
    # this executable. Without freeze_support() each helper would start a second server.
    multiprocessing.freeze_support()

    import uvicorn

    from app.config import settings
    from app.main import app

    # No reload / import string: PyInstaller needs the app object passed directly.
    uvicorn.run(app, host=settings.host, port=settings.port)
