---
title: Tell Me
emoji: 🎙️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
short_description: Online engine for Tell Me. (transcribe, search, answer)
---

# Tell Me. online engine

The API behind the Tell Me. website for people without the Mac app (Windows, phones).
It runs Whisper (speech to text), Redis vector search and a local Llama 3.2 1B model through Ollama,
all inside this Space. Users sign in with their Tell Me. account; every request needs their token.

Source: https://github.com/SubhajitMitra-GH/AudioSummary (deployed with `scripts/deploy-server.sh`).
