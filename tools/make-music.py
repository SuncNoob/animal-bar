#!/usr/bin/env python3
"""The jukebox's three house tracks, synthesised from scratch (numpy + ffmpeg), so the game ships music it owns.
Released under CC0 with the rest of the generated assets. Run: python3 tools/make-music.py  → public/music/*.m4a
"""
import subprocess, tempfile, wave, os
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'music')
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(n, a=0.01, d=0.3, s=0.6, r=0.2, dur=None):
    """ADSR envelope over n samples (times in seconds)."""
    t = np.arange(n) / SR
    dur = dur if dur is not None else n / SR
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-4), e)
    e = np.where(t >= a + d, s, e)
    rel = np.clip((t - (dur - r)) / max(r, 1e-4), 0, 1)
    return e * (1 - rel)


def epiano(f, dur, vel=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3) + 0.12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 6)
    return vel * tone * env(n, 0.005, 0.6, 0.35, 0.15) * (1 + 0.04 * np.sin(2 * np.pi * 5 * t))


def pluck(f, dur, vel=0.5, bright=6.0):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = sum(np.sin(2 * np.pi * f * k * t) / k ** 1.3 * np.exp(-t * bright * k ** 0.5) for k in range(1, 6))
    return vel * tone * env(n, 0.002, 0.05, 1.0, 0.05)


def musicbox(f, dur, vel=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t * 9)
    return vel * tone * np.exp(-t * 2.2) * env(n, 0.002, 0.01, 1.0, 0.05)


def bass(f, dur, vel=0.6):
    n = int(dur * SR); t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)
    return vel * np.tanh(1.5 * tone) * env(n, 0.005, 0.2, 0.7, 0.08)


def kick(vel=0.9):
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def hat(vel=0.25, length=0.06):
    n = int(length * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(6) / 6, 'same')  # crude high-pass
    return vel * noise * np.exp(-t * 60)


def snare(vel=0.4):
    n = int(0.2 * SR); t = np.arange(n) / SR
    return vel * (0.6 * rng.standard_normal(n) * np.exp(-t * 22) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30))


class Track:
    def __init__(self, seconds):
        self.buf = np.zeros(int(seconds * SR) + SR)

    def add(self, at, sig, pan=0.0):
        i = int(at * SR); j = min(len(self.buf), i + len(sig))
        self.buf[i:j] += sig[: j - i]

    def render(self, name, seconds):
        x = self.buf[: int(seconds * SR)]
        # gentle room: two short feedback-free echoes, then normalise and soft-limit
        for d, g in ((0.11, 0.18), (0.23, 0.1)):
            k = int(d * SR); x = x + g * np.concatenate([np.zeros(k), x[:-k]])
        fade = int(1.5 * SR); x[-fade:] *= np.linspace(1, 0, fade); x[:int(0.05 * SR)] *= np.linspace(0, 1, int(0.05 * SR))
        x = np.tanh(1.2 * x / (np.max(np.abs(x)) + 1e-9)) * 0.85
        pcm = (x * 32767).astype(np.int16)
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            with wave.open(tmp.name, 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
            os.makedirs(OUT, exist_ok=True)
            dst = os.path.join(OUT, name + '.m4a')
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-c:a', 'aac', '-b:a', '96k', '-ac', '2', dst], check=True)
        os.unlink(tmp.name)
        print(f'{dst}  {seconds:.2f}s')
        return seconds


def courtyard_breeze():
    """院子晚风: mellow electric piano over Fmaj7 – Em7 – Dm7 – Cmaj7, 80 bpm, soft brushed beat."""
    bpm, bars = 80, 24; beat = 60 / bpm; secs = bars * 4 * beat
    tr = Track(secs)
    chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]
    melody = [72, 69, 67, 64, 65, 67, 69, 72, 71, 67, 64, 62, 64, 65, 67, 64]
    for b in range(bars):
        ch = chords[b % 4]; t0 = b * 4 * beat
        for k, m in enumerate(ch): tr.add(t0 + k * 0.03, epiano(hz(m), 4 * beat, 0.16))
        tr.add(t0, bass(hz(ch[0] - 12), 2 * beat, 0.4)); tr.add(t0 + 2.5 * beat, bass(hz(ch[0] - 12 + 7), 1.4 * beat, 0.3))
        if b >= 4:
            tr.add(t0, kick(0.5)); tr.add(t0 + 2.5 * beat, kick(0.35))
            tr.add(t0 + beat, snare(0.18)); tr.add(t0 + 3 * beat, snare(0.18))
            for h in range(8): tr.add(t0 + h * beat / 2 + (0.03 if h % 2 else 0), hat(0.07 if h % 2 else 0.1))
        if 8 <= b < 20:
            for k in range(4):
                m = melody[((b - 8) * 4 + k) % len(melody)]
                tr.add(t0 + k * beat + (0.5 * beat if k % 2 else 0), epiano(hz(m), 1.2 * beat, 0.22))
    return tr.render('courtyard-breeze', secs)


def lagoon_bounce():
    """湖边蹦迪: four-on-the-floor, Am – F – C – G, plucked arpeggios, 120 bpm."""
    bpm, bars = 120, 32; beat = 60 / bpm; secs = bars * 4 * beat
    tr = Track(secs)
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
    for b in range(bars):
        ch = chords[b % 4]; t0 = b * 4 * beat
        for k in range(4):
            tr.add(t0 + k * beat, kick(0.8 if b >= 2 else 0.5))
            tr.add(t0 + k * beat + beat / 2, hat(0.16))
            if k % 2: tr.add(t0 + k * beat, snare(0.32 if b >= 4 else 0.15))
            tr.add(t0 + k * beat + beat / 2, bass(hz(ch[0] - 24), beat / 2, 0.55))
        if b >= 4:
            arp = ch + [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 12, ch[2]]
            for s in range(16): tr.add(t0 + s * beat / 4, pluck(hz(arp[s % len(arp)] + 12), beat / 4 * 1.6, 0.13))
        if 12 <= b < 28 and b % 2 == 0:
            for k, m in enumerate([ch[2] + 12, ch[1] + 12, ch[0] + 12, ch[1] + 12]):
                tr.add(t0 + k * beat * 2, pluck(hz(m + 12), beat * 1.5, 0.22, 3.0))
    return tr.render('lagoon-bounce', secs)


def ginkgo_waltz():
    """银杏华尔兹: a music-box waltz in 3/4, C – Am – F – G, 96 bpm."""
    bpm, bars = 96, 32; beat = 60 / bpm; secs = bars * 3 * beat
    tr = Track(secs)
    chords = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]]
    tune = [76, 74, 72, 74, 76, 76, 77, 76, 74, 72, 71, 72, 69, 71, 72, 74, 72, 71, 72, 74, 76, 79, 77, 74]
    for b in range(bars):
        ch = chords[b % 4]; t0 = b * 3 * beat
        tr.add(t0, bass(hz(ch[0]), beat, 0.3))
        for k in (1, 2):
            for m in ch[1:]: tr.add(t0 + k * beat, musicbox(hz(m + 12), beat, 0.08))
        for k in range(3):
            if b >= 2: tr.add(t0 + k * beat, musicbox(hz(tune[(b * 3 + k) % len(tune)]), 1.5 * beat, 0.3 if k == 0 else 0.22))
    return tr.render('ginkgo-waltz', secs)


if __name__ == '__main__':
    courtyard_breeze(); lagoon_bounce(); ginkgo_waltz()
