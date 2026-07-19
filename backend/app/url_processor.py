import os
import re
import logging
import requests
import yt_dlp

logger = logging.getLogger("uvicorn.error")

def download_audio_from_url(url: str, output_path_without_ext: str) -> str:
    """Download audio from a YouTube link or direct audio link, returning the final filepath.
    
    Args:
        url: The audio URL or YouTube video URL.
        output_path_without_ext: Destination path inside the temp folder (without extension).
        
    Returns:
        The final absolute file path of the downloaded file.
    """
    
    # Check if it is a YouTube URL
    youtube_regex = (
        r'(https?://)?(www\.)?'
        r'(youtube|youtu|youtube-nocookie)\.(com|be)/'
        r'(watch\?v=|embed/|v/|.+\?v=)?([^&=%\?]{11})'
    )
    is_youtube = re.match(youtube_regex, url) is not None
    
    if is_youtube:
        logger.info(f"URL detected as YouTube: {url}")
        
        # Locate ffmpeg to prevent Broken pipe errors in packaged apps
        ffmpeg_loc = None
        for p in ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']:
            if os.path.exists(p):
                ffmpeg_loc = os.path.dirname(p)
                break
                
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': output_path_without_ext,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
            'nocheckcertificate': True,
            'extractor_args': {
                'youtube': {
                    'player_client': ['ios', 'android', 'web_creator', 'web']
                }
            }
        }
        
        if ffmpeg_loc:
            ydl_opts['ffmpeg_location'] = ffmpeg_loc
            logger.info(f"FFmpeg location set for yt-dlp: {ffmpeg_loc}")
        
        # Try to use cookies from common browsers to bypass YouTube bot detection
        browsers_to_try = ['chrome', 'safari', 'firefox', 'brave']
        download_success = False
        last_error = None

        for browser in browsers_to_try:
            try:
                logger.info(f"Attempting YouTube download using cookies from browser: {browser}")
                current_opts = ydl_opts.copy()
                current_opts['cookiesfrombrowser'] = (browser,)
                with yt_dlp.YoutubeDL(current_opts) as ydl:
                    ydl.download([url])
                download_success = True
                break
            except Exception as e:
                logger.warning(f"Failed to download using cookies from {browser}: {e}")
                last_error = e

        if not download_success:
            # Fallback: attempt without cookies
            try:
                logger.info("Attempting YouTube download without browser cookies...")
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                download_success = True
            except Exception as e:
                logger.error(f"yt-dlp extraction failed: {e}")
                last_error = e

        if not download_success:
            raise RuntimeError(
                f"Failed to extract audio from YouTube link: {last_error}. "
                "YouTube flagged the request as bot traffic. Please make sure you are logged in to YouTube in Chrome or Safari "
                "on your computer to share the browser cookies and try again."
            )
            
        # yt-dlp appends .mp3 because of postprocessor
        final_path = f"{output_path_without_ext}.mp3"
        logger.info(f"YouTube audio downloaded successfully: {final_path}")
        return final_path
            
    else:
        logger.info(f"URL detected as direct file link: {url}")
        try:
            # Direct link download chunk by chunk
            response = requests.get(url, stream=True, timeout=30)
            response.raise_for_status()
            
            # Infer extension from Content-Type or URL
            ext = ".mp3"
            content_type = response.headers.get("Content-Type", "").lower()
            if "wav" in content_type:
                ext = ".wav"
            elif "webm" in content_type:
                ext = ".webm"
            elif "m4a" in content_type:
                ext = ".m4a"
            elif "ogg" in content_type:
                ext = ".ogg"
            elif "flac" in content_type:
                ext = ".flac"
            else:
                # Check url path extension
                url_path_ext = os.path.splitext(url.split("?")[0])[1].lower()
                if url_path_ext in {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}:
                    ext = url_path_ext

            final_path = f"{output_path_without_ext}{ext}"
            logger.info(f"Downloading direct link to: {final_path}")
            
            with open(final_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            logger.info(f"Direct file downloaded successfully: {final_path}")
            return final_path
        except Exception as e:
            logger.error(f"Direct link download failed: {e}")
            raise RuntimeError(f"Failed to download audio from direct link: {e}")
