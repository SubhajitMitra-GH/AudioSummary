#!/usr/bin/env bash
# Build the vertical (1080x1920, 30 fps) Tell Me. intro video with voiceover and background music.
#   ./video/build.sh            → video/out/tell-me-intro.mp4 (voice + music) and tell-me-intro-music-only.mp4
#   SKIP_FRAMES=1 ./video/build.sh   re-mix audio only, reusing rendered frames
# Needs: Google Chrome, ffmpeg, Node 22+, backend/.venv (numpy + scipy) and macOS `say` (voice: Samantha).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/.work"
OUT="$HERE/out"
mkdir -p "$WORK" "$OUT" "$HERE/vo"
PY="$HERE/../backend/.venv/bin/python"
DUR=42.22   # 19 bars at 108 BPM; must match DURATION in intro.html

echo "▸ Voiceover"
LINES=(
  "Got a two hour meeting recording? Don't listen to it all again."
  "Meet Tell Me. Ask your recordings anything."
  "Record, upload a file, or paste a YouTube link."
  "It transcribes everything, right on your Mac."
  "Then just ask. Every answer comes from what was actually said, and shows the passages it used."
  "Your audio never goes to a cloud A.I. No A.P.I. keys. No fees per question. And it works offline."
  "Stop re-listening. Start asking. Get Tell Me for your Mac."
)
# Start of each line in ms (scene start on the bar grid + a short lead-in).
DELAYS=(150 4794 8989 13483 18028 26867 35706)
for i in "${!LINES[@]}"; do say -v Samantha -r 178 -o "$HERE/vo/s$((i + 1)).aiff" "${LINES[$i]}"; done

echo "▸ Music"
"$PY" "$HERE/music.py" "$WORK/music.wav" "$DUR"

if [[ "${SKIP_FRAMES:-0}" != "1" ]]; then
  echo "▸ Frames (headless Chrome)"
  rm -rf "$WORK/frames"
  node "$HERE/render.mjs" "$WORK/frames" 30
fi

echo "▸ Mix"
inputs=() ; chains="" ; labels=""
for i in "${!DELAYS[@]}"; do
  inputs+=(-i "$HERE/vo/s$((i + 1)).aiff")
  d=${DELAYS[$i]}
  chains+="[$((i + 1)):a]aresample=44100,aformat=channel_layouts=stereo,adelay=${d}|${d}[v$i];"
  labels+="[v$i]"
done
VOICE_FX="highpass=f=90,equalizer=f=3500:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=2.2"
ffmpeg -v error -y -i "$WORK/music.wav" "${inputs[@]}" -filter_complex "
  ${chains}${labels}amix=inputs=${#DELAYS[@]}:normalize=0,${VOICE_FX},apad,atrim=0:${DUR},asplit=2[vo][key];
  [0:a]volume=0.28[mus];
  [mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400[ducked];
  [ducked][vo]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]" \
  -map "[out]" -ar 48000 "$WORK/mix.wav"
ffmpeg -v error -y -i "$WORK/music.wav" -af "volume=0.8,loudnorm=I=-16:TP=-1.5:LRA=11" -ar 48000 "$WORK/music-only.wav"

echo "▸ Encode"
for variant in mix music-only; do
  name=tell-me-intro; [[ $variant == music-only ]] && name=tell-me-intro-music-only
  ffmpeg -v error -y -framerate 30 -i "$WORK/frames/f%05d.jpg" -i "$WORK/$variant.wav" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -movflags +faststart \
    -c:a aac -b:a 192k -shortest "$OUT/$name.mp4"
done
ls -lh "$OUT"
