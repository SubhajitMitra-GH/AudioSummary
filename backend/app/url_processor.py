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
        '(youtube|youtu|youtube-nocookie)\.(com|be)/'
        '(watch\?v=|embed/|v/|.+\?v=)?([^&=%\?]{11})'
    )
    is_youtube = re.match(youtube_regex, url) is not None
    
    if is_youtube:
        logger.info(f"URL detected as YouTube: {url}")
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': output_path_without_ext,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            
            # yt-dlp appends .mp3 because of postprocessor
            final_path = f"{output_path_without_ext}.mp3"
            logger.info(f"YouTube audio downloaded successfully: {final_path}")
            return final_path
        except Exception as e:
            logger.error(f"yt-dlp extraction failed: {e}")
            raise RuntimeError(f"Failed to extract audio from YouTube link: {e}")
            
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
