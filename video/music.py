"""Original background track for the Tell Me. intro video (synthesised here, so it is royalty-free).

108 BPM, Fmaj7 - G6 - Em7 - Am7. Soft hats in the hook, drums drop in when the logo appears,
drums thin out for the final call to action, then the last chord rings out.
Usage: python music.py out.wav <seconds>
"""
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
BPM = 108
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

out_path = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
length = float(sys.argv[2]) if len(sys.argv) > 2 else 44.0
N = int((length + 3.0) * SR)
L = np.zeros(N)
R = np.zeros(N)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def place(buf, start_s, sig, gain=1.0):
    i = int(start_s * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def env_adsr(n, a, d, s, r_len):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r_len * SR)
    e = np.full(n + r_n, s)
    e[:a_n] = np.linspace(0, 1, a_n, endpoint=False)
    e[a_n:a_n + d_n] = np.linspace(1, s, d_n, endpoint=False)
    e[n:] = np.linspace(s, 0, r_n)
    return e


# Chords as MIDI notes (voiced around middle C) and bass roots.
CHORDS = [
    [53, 57, 60, 64],  # Fmaj7  F A C E
    [55, 59, 62, 64],  # G6     G B D E
    [52, 55, 59, 62],  # Em7    E G B D
    [57, 60, 64, 67],  # Am7    A C E G
]
ROOTS = [41, 43, 40, 45]  # F2 G2 E2 A2

n_bars = int(np.ceil(length / BAR)) + 1
DROP_BAR = 2                     # logo reveal (scene 2) starts on bar 2
OUTRO_BAR = n_bars - 4           # thin out for the final scene
END_BAR = n_bars - 1             # last bar: ringing chord only

# --- pad: detuned additive saws, low-passed, with a slow swell per bar ---
pad_L = np.zeros(N)
pad_R = np.zeros(N)
lp_pad = butter(2, 1800, "low", fs=SR, output="sos")
for b in range(n_bars):
    chord = CHORDS[b % 4]
    dur = BAR if b < END_BAR else BAR * 2.2
    n = int(dur * SR)
    t = np.arange(n + int(0.6 * SR)) / SR
    e = env_adsr(n, 0.35, 0.4, 0.75, 0.6)
    for k, note in enumerate(chord):
        f = midi(note)
        for side, det in ((pad_L, 0.9975), (pad_R, 1.0025)):
            sig = np.zeros_like(t)
            for h in range(1, 9):
                sig += np.sin(2 * np.pi * f * det * h * t + k) / h ** 1.3
            place(side, b * BAR, sig * e, 0.045)
pad_L = sosfilt(lp_pad, pad_L)
pad_R = sosfilt(lp_pad, pad_R)

# --- kick pump (sidechain feel) applied to the pad once drums are in ---
pump = np.ones(N)
for b in range(DROP_BAR, END_BAR):
    for beat in range(4):
        i = int((b * BAR + beat * BEAT) * SR)
        m = int(0.42 * SR)
        curve = 1 - 0.55 * np.exp(-np.linspace(0, 5, m))
        j = min(N, i + m)
        pump[i:j] = np.minimum(pump[i:j], curve[: j - i])
L += pad_L * pump
R += pad_R * pump

# --- pluck arpeggio: 8th notes through chord tones, ping-pong ---
ARP = [0, 2, 1, 3, 2, 1, 3, 2]
for b in range(n_bars - 1):
    if b < 1:
        continue  # enters on bar 1, half way through the hook
    chord = CHORDS[b % 4]
    for s in range(8):
        note = chord[ARP[s]] + 12
        f = midi(note)
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        sig = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t))
        sig *= np.exp(-t * 9) * np.minimum(1, t / 0.003)
        g = 0.11 if b >= DROP_BAR else 0.07
        if b >= OUTRO_BAR:
            g = 0.08
        start = b * BAR + s * BEAT / 2
        pan = 0.35 if s % 2 else -0.35
        place(L, start, sig, g * (1 - pan))
        place(R, start, sig, g * (1 + pan))
        # dotted-8th echo
        place(L, start + BEAT * 0.75, sig, g * 0.35 * (1 + pan))
        place(R, start + BEAT * 0.75, sig, g * 0.35 * (1 - pan))

# --- bass: round sine + a little 2nd harmonic, rhythm 1 . . & 3 . & . ---
BASS_HITS = [(0, 0.9), (1.5, 0.4), (2, 0.9), (3.5, 0.4)]
for b in range(DROP_BAR, END_BAR):
    f = midi(ROOTS[b % 4])
    for pos, ln in BASS_HITS:
        n = int(ln * BEAT * SR)
        t = np.arange(n) / SR
        sig = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
        sig *= np.minimum(1, t / 0.008) * np.minimum(1, (n / SR - t) / 0.03)
        g = 0.32 if b < OUTRO_BAR else 0.22
        place(L, b * BAR + pos * BEAT, sig, g)
        place(R, b * BAR + pos * BEAT, sig, g)

# --- drums ---
def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 85 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) + 0.15 * np.exp(-t * 300) * rng.standard_normal(n)


hp_hat = butter(4, 7000, "high", fs=SR, output="sos")
bp_snare = butter(2, [900, 5000], "band", fs=SR, output="sos")


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return sosfilt(hp_hat, rng.standard_normal(n)) * np.exp(-t * (18 if open_ else 70))


def clap():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = sosfilt(bp_snare, rng.standard_normal(n))
    env = np.exp(-t * 22)
    for off in (0.0, 0.011, 0.022):  # three quick slaps = clap
        k = int(off * SR)
        env[k:k + 60] += 0.6
    body = 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    return noise * env + body


K = kick()
for b in range(n_bars - 1):
    in_drums = DROP_BAR <= b < END_BAR
    outro = b >= OUTRO_BAR
    for e8 in range(8):
        pos = b * BAR + e8 * BEAT / 2
        if b >= END_BAR:
            break
        # hats everywhere (soft in the hook), offbeats louder
        hg = 0.05 if e8 % 2 == 0 else 0.09
        if not in_drums:
            hg *= 0.6
        open_ = e8 == 7 and b % 2 == 1
        h = hat(open_)
        place(L, pos, h, hg * 0.8)
        place(R, pos, h, hg * 1.1)
    if in_drums:
        for beat in range(4):
            if outro and beat % 2:
                continue
            place(L, b * BAR + beat * BEAT, K, 0.55)
            place(R, b * BAR + beat * BEAT, K, 0.55)
        if not outro:
            for beat in (1, 3):
                c = clap()
                place(L, b * BAR + beat * BEAT, c, 0.16)
                place(R, b * BAR + beat * BEAT, c, 0.18)

# riser into the drop (noise swell over the last half bar of the hook)
n = int(BAR / 2 * SR)
t = np.linspace(0, 1, n)
riser = sosfilt(butter(2, 3000, "high", fs=SR, output="sos"), rng.standard_normal(n)) * t ** 2.5
place(L, DROP_BAR * BAR - BAR / 2, riser, 0.12)
place(R, DROP_BAR * BAR - BAR / 2, riser, 0.12)

# --- room reverb: decaying stereo noise impulse ---
ir_n = int(1.6 * SR)
ir_t = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-ir_t * 3.2)
irR = rng.standard_normal(ir_n) * np.exp(-ir_t * 3.2)
irL /= np.sqrt(np.sum(irL ** 2))
irR /= np.sqrt(np.sum(irR ** 2))
wetL = fftconvolve(L, irL)[:N]
wetR = fftconvolve(R, irR)[:N]
L = L + 0.22 * wetL
R = R + 0.22 * wetR

# --- master: gentle low cut, soft clip, fade out, normalise ---
hp = butter(2, 30, "high", fs=SR, output="sos")
L, R = sosfilt(hp, L), sosfilt(hp, R)
mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
total = int(length * SR)
mix = mix[:total]
fade = int(2.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
mix[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
mix /= np.max(np.abs(mix)) / 0.89
wavfile.write(out_path, SR, (mix * 32767).astype(np.int16))
print(f"wrote {out_path}: {length:.2f}s, {BPM} BPM, {n_bars} bars")
