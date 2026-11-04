---
name: Tell Me. — Clean light + cobalt
description: Bright, calm, private. One electric cobalt for action, lime as a highlighter, charts that prove the claims.
colors:
  bg: "#f7f8fa"
  surface: "#ffffff"
  sunk: "#eef0f4"
  ink: "#0e1116"
  ink-2: "#454c5a"
  ink-3: "#646b79"
  line: "#e3e6ec"
  line-strong: "#c9ced8"
  cobalt: "#2f5bff"
  cobalt-hover: "#1f47e6"
  cobalt-wash: "#ecf1ff"
  lime: "#d4ff3f"
  ember: "#e2552e"
  ember-wash: "#fdeee9"
  success: "#12805c"
  danger: "#c92a1e"
  danger-wash: "#fdecea"
  dark-bg: "#0d0f14"
  dark-surface: "#14161c"
  dark-ink: "#f1f3f7"
  dark-cobalt: "#5f7dff"
  dark-ember: "#e85a34"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3.2rem, 8vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  number:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "24px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "32px"
  section: "112px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  stat-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.xl}"
    padding: "28px"
  badge-recommended:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
---

## Overview

Tell Me. looks like a calm, modern product page and app (references: Twain, Telescope, Wafer.ai, Orchid Security on Awwwards). The surface is bright cool white; content sits in soft white cards that float with gentle depth. One colour does the work: **electric cobalt** marks every action and everything that is "Tell Me.". **Lime** is a highlighter only (the hero word, the exact words an answer was taken from, the Recommended badge). **Ember** appears only as the "cloud chatbot" series in comparisons.

The page proves its claims instead of stating them: an animated answer with its source passage, token charts, a privacy map and a grounding diagram. Numbers are estimates and always labelled as such.

## Colors

- `bg` page, `surface` cards, `sunk` tracks/inputs/idle chips. Dark theme swaps to `dark-*` tones; every token has a dark twin in `globals.css` under `[data-theme="dark"]`.
- `ink` / `ink-2` / `ink-3`: text levels; `ink-3` is the floor for readable text (≥4.5:1 on `bg`).
- `cobalt` (+ `cobalt-wash` tint): primary buttons, links, selected states, Tell Me. chart series, source chips.
- `lime`: highlighter behind words (`.hl`, `.src-mark`), Recommended badge, user avatar. Always with `ink` text.
- `ember` (+ `ember-wash`): the cloud-chatbot series in charts and the "leaves your device" side of the privacy map. Never a button.
- `success`, `danger`: status only, always with an icon or words.
- Chart palette is validated for colour-blind separation: light `#2F5BFF / #E2552E`, dark `#5F7DFF / #E85A34`.

## Typography

- **Bricolage Grotesque** (`.t-display`, `.t-title`): headlines and big figures. Tight tracking (-0.035em), line-height ≈1. Headlines are short sentences ending with a full stop.
- **Figtree**: all UI and body text.
- **JetBrains Mono** (`.t-num`): numbers that align or are measurements (token counts, sizes, times, model ids, passage numbers). Never prose.
- Display max 6rem; body measure ≤ 65ch.

## Layout

- Landing: 1200px max width, 16px phone gutters, sections of 80–112px vertical padding, alternating `bg` and `surface` bands with hairline borders.
- Hero: copy left, floating card stack right (passage, token badge, chat, on-device pill) with scroll parallax on large screens only.
- App: 18rem white sidebar (overlays content under 768px), 56px header, 50rem chat column, floating composer pinned at the bottom.

## Elevation & Depth

Two shadows only: `--shadow-float` (resting cards) and `--shadow-pop` (the focused card: hero chat, recorder, sign-in). No glows, no glass.

## Shapes

Soft and friendly: 20–24px cards, 12px inner tiles, pill buttons and chips, fully rounded speech bars.

## Components

- **Wordmark** (`components/ui/Brand.tsx`): "Tell Me" in Bricolage with a cobalt dot as the full stop.
- **SpeechBars**: rounded waveform bars (deterministic heights); `progress` colours the played part. Used as the product's icon language (session icons, loading, setup progress).
- **LevelMeter**: live microphone waveform from a Web Audio analyser.
- **Charts** (`components/landing/Charts.tsx`): token line chart with crosshair tooltip + slider + table view; 10-question bar chart; passage dot grid. Estimates come from the `ASSUME` constants that mirror backend settings (chunk 1000/150, k=6).
- **Illustrations** (`components/landing/Illustrations.tsx`): pipeline cards, privacy map (laptops, cloud/server), grounding diagram with numbered source chips and drawn connectors.
- **Chat**: user questions in ink bubbles (right), answers in plain text beside a cobalt avatar, "N passages used" chip expanding to the passages, Copy, time.

## Do's and Don'ts

- Do show evidence for every claim, and label estimates and illustrative examples.
- Do keep cobalt as the only action colour; lime only highlights; ember only means "cloud chatbot".
- Don't invent accuracy percentages, benchmarks, testimonials or user counts.
- Don't use dark neon "AI" styling, purple gradients, gradient text or glassmorphism.
- Don't put icon tiles or eyebrow labels above headlines.
- Don't animate layout properties; use transform/opacity. Respect `prefers-reduced-motion`.
