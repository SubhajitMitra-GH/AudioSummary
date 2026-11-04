# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Next.js static export shown inside an Electron shell on macOS; also runs in a browser on `localhost:3000` during development.)

## Users

Inferred from the existing app copy, not confirmed in an interview: people who have long spoken recordings (meetings, lectures, interviews, podcasts, voice notes) and want to ask questions about them instead of re-listening. They work on their own Mac and care that the audio stays private.

## Product Purpose

Tell Me. turns a recording into something you can question. The user records, uploads a file, or pastes a YouTube or direct audio link. The app transcribes it on the computer (Whisper), indexes it (local embeddings in Redis), and answers questions using a local language model (Ollama). Success: the user gets a correct answer from their own recording in seconds, without the audio leaving the machine.

## Positioning

Unlike cloud chatbots (ChatGPT-style assistants), the whole pipeline runs on the user's Mac:
- Audio is transcribed locally and the file is deleted after processing; it is never sent to an AI service.
- Answers are built only from passages retrieved from the user's own transcript; the model is told to say when the recording doesn't contain the answer.
- No per-question cost or API key; open models (Llama 3.2 1B/3B, Mistral) run through Ollama.
- After setup, recording, transcription, search and chat work offline.

Honest limits that copy must not hide: sign-in needs internet; transcripts, messages, titles and the search index are encrypted and backed up to the cloud (Supabase) for restore on other devices; the encryption key is shared per install, so this is not end-to-end encryption.

## Operating Context

Desktop app window on macOS. First run: sign in, then install Ollama and choose a model (Fast 1.3 GB, Balanced 2.0 GB recommended, Best quality 4.1 GB). Daily use: sidebar of conversations, one recording/source per conversation (more can be added), chat about it. Long ingestions run in a single request with no progress reporting.

## Capabilities and Constraints

- Inputs: microphone recording (webm), upload (.wav .mp3 .m4a .ogg .flac .webm, ≤200 MB), YouTube or direct audio link.
- Chat: question → answer from the active local model; the backend also returns the retrieved passages (`context`), which the UI currently does not show.
- Sessions: create, rename, delete; offline queue syncs on sign-in and when the connection returns.
- Model choice in the sidebar and setup wizard.
- Static export only: no server-side rendering features. Fonts must be self-hosted/bundled (next/font) because the app runs offline.

## Brand Commitments

Name: "Tell Me." (with the full stop). No other visual commitments; the current violet/Inter look is not binding.

## Evidence on Hand

No testimonials, customer logos, benchmarks or user counts exist. Do not invent any. Demo transcript content on marketing surfaces must be clearly illustrative.

## Product Principles

1. The recording is the source of truth; every answer should feel traceable back to what was said.
2. Private by construction, and honest about the exceptions (cloud backup, sign-in).
3. Local AI should feel calm and capable, not like a cheaper chatbot.
4. Never block the user on setup without explaining what is happening and why.

## Accessibility & Inclusion

No product-specific requirement established; follow WCAG AA contrast, keyboard access, and reduced-motion preferences.
