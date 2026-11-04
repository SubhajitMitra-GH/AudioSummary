import os
import socket
import logging
import ipaddress
from urllib.parse import urljoin, urlparse

import requests
import yt_dlp

from app.config import settings

logger = logging.getLogger("uvicorn.error")

YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
    "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}
MAX_REDIRECTS = 5


class IngestError(Exception):
    """An ingestion failure whose message is safe and useful to show to the user."""


def validate_public_url(url: str) -> str:
    """Allow only http(s) URLs that resolve to public internet addresses.

    Blocks localhost, private LAN ranges, link-local and other internal addresses so a link
    can't be used to make this machine fetch internal services.
    """
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise IngestError("Only http:// and https:// links are supported.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror:
        raise IngestError("Could not resolve the link's address. Check the URL and your connection.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise IngestError("Links to local or private network addresses are not allowed.")
    return url.strip()


def is_youtube_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in YOUTUBE_HOSTS


def _find_ffmpeg_dir() -> str | None:
    # Locate ffmpeg to prevent Broken pipe errors in packaged apps
    for p in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]:
        if os.path.exists(p):
            return os.path.dirname(p)
    return None


def _download_youtube(url: str, output_path_without_ext: str) -> str:
    logger.info("URL detected as YouTube.")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_path_without_ext,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "quiet": True,
        # Never download a whole playlist when the link has &list=...
        "noplaylist": True,
        "max_filesize": settings.max_upload_bytes,
        "extractor_args": {
            "youtube": {
                "player_client": ["ios", "android", "web_creator", "web"]
            }
        },
    }
    ffmpeg_dir = _find_ffmpeg_dir()
    if ffmpeg_dir:
        ydl_opts["ffmpeg_location"] = ffmpeg_dir

    # Browser cookies help get past YouTube's bot detection. Without them, try anonymously last.
    attempts = [("chrome",), ("safari",), ("firefox",), ("brave",), None]
    last_error = None
    for browser in attempts:
        opts = dict(ydl_opts)
        if browser:
            opts["cookiesfrombrowser"] = browser
        try:
            logger.info(f"Attempting YouTube download ({'cookies from ' + browser[0] if browser else 'no cookies'})")
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            # yt-dlp appends .mp3 because of the postprocessor
            final_path = f"{output_path_without_ext}.mp3"
            if not os.path.exists(final_path):
                raise IngestError("The video was skipped, most likely because it is larger than the size limit.")
            return final_path
        except IngestError:
            raise
        except Exception as e:
            logger.warning(f"YouTube download attempt failed: {e}")
            last_error = e

    logger.error(f"yt-dlp extraction failed: {last_error}")
    raise IngestError(
        "Could not download audio from this YouTube link. YouTube may have flagged the request as bot "
        "traffic: make sure you are signed in to YouTube in Chrome or Safari and try again."
    )


def _download_direct(url: str, output_path_without_ext: str) -> str:
    logger.info("URL detected as direct file link.")
    current = url
    # Follow redirects by hand so every hop is checked against private addresses.
    for _ in range(MAX_REDIRECTS + 1):
        validate_public_url(current)
        response = requests.get(current, stream=True, timeout=30, allow_redirects=False)
        if response.is_redirect:
            current = urljoin(current, response.headers.get("Location", ""))
            response.close()
            continue
        break
    else:
        raise IngestError("The link redirects too many times.")

    with response:
        if response.status_code != 200:
            raise IngestError(f"The link returned HTTP {response.status_code}.")

        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" in content_type:
            raise IngestError(
                "This link opens a web page, not an audio file. Use a direct audio link or a YouTube link "
                "(Spotify and other streaming pages are not supported)."
            )

        declared = response.headers.get("Content-Length")
        if declared and declared.isdigit() and int(declared) > settings.max_upload_bytes:
            raise IngestError(f"The file is larger than the {settings.max_upload_mb} MB limit.")

        # Infer extension from Content-Type or URL
        ext = ".mp3"
        for marker, candidate in (("wav", ".wav"), ("webm", ".webm"), ("m4a", ".m4a"), ("mp4", ".m4a"), ("ogg", ".ogg"), ("flac", ".flac")):
            if marker in content_type:
                ext = candidate
                break
        else:
            url_ext = os.path.splitext(urlparse(current).path)[1].lower()
            if url_ext in AUDIO_EXTENSIONS:
                ext = url_ext

        final_path = f"{output_path_without_ext}{ext}"
        written = 0
        try:
            with open(final_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > settings.max_upload_bytes:
                        raise IngestError(f"The file is larger than the {settings.max_upload_mb} MB limit.")
                    f.write(chunk)
        except BaseException:
            if os.path.exists(final_path):
                os.remove(final_path)
            raise

    logger.info(f"Direct file downloaded successfully ({written} bytes).")
    return final_path


def download_audio_from_url(url: str, output_path_without_ext: str) -> str:
    """Download audio from a YouTube link or direct audio link, returning the final filepath.

    Raises IngestError with a user-facing message on any expected failure.
    """
    url = validate_public_url(url)
    if is_youtube_url(url):
        return _download_youtube(url, output_path_without_ext)
    try:
        return _download_direct(url, output_path_without_ext)
    except IngestError:
        raise
    except requests.RequestException as e:
        logger.error(f"Direct link download failed: {e}")
        raise IngestError("Could not download the file from this link.")
