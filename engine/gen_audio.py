"""avatar-studio audio: the voice (Kokoro, on this machine), word timings, and the loudness of every frame.

usage:  python gen_audio.py <project_dir>          (or: avatar audio <project_dir>)
        Run it with the Python that has kokoro-onnx installed (default: ~/kokoro/.venv/bin/python).

Adapted from reel-studio's engine/gen_audio.py (MIT, same author). Word times come from the voice model's own
phoneme durations when kokoro-onnx can report them (0.6 or newer, see word_timing.py, copied from reel-studio);
otherwise, or with AVATAR_TIMING=estimate, they are spread by syllable count.

env     KOKORO_HOME    folder holding the model files (default ~/kokoro)
        KOKORO_MODEL   path of kokoro-v1.0.onnx (default $KOKORO_HOME/kokoro-v1.0.onnx)
        KOKORO_VOICES  path of voices-v1.0.bin  (default $KOKORO_HOME/voices-v1.0.bin)

reads   <project>/script.json   lines[{say, pause}], title.hold, end.hold, voice, speed, lang, pronounce, fps, lead, gap, tail
writes  <project>/build/timeline.json   when every line and word is said, and "loudness": the voice's RMS level per video frame
        <project>/build/voice.wav       the voice, 24 kHz mono
        <project>/build/.voice-cache/   spoken phrases, reused when a line has not changed
"""
import hashlib, json, os, re, sys
from pathlib import Path


def die(msg):
    sys.exit("avatar audio: " + msg)


if len(sys.argv) < 2: die("usage: python gen_audio.py <project_dir>")
try:
    import numpy as np, soundfile as sf
    from kokoro_onnx import Kokoro
except ImportError as e:
    die(f"{e}. Install the voice packages into this Python: pip install kokoro-onnx soundfile numpy")

sys.path.insert(0, str(Path(__file__).resolve().parent))
P = Path(sys.argv[1]).resolve()
SCRIPT = P / "script.json"
if not SCRIPT.is_file(): die(f"file not found: {SCRIPT}")
try:
    S = json.loads(SCRIPT.read_text(encoding="utf-8"))
except json.JSONDecodeError as e:
    die(f"script.json is not valid JSON: {e}")
LINES = S.get("lines")
if not isinstance(LINES, list) or not LINES: die('script.json has no "lines" list (run: avatar lint)')
for i, ln in enumerate(LINES):
    if not isinstance(ln, dict) or not str(ln.get("say", "")).strip(): die(f'line {i + 1} needs "say" (run: avatar lint)')

OUT = P / "build"; OUT.mkdir(parents=True, exist_ok=True)
VOICE = S.get("voice", "af_heart")
SPEED = float(S.get("speed", 1.0))
LANG = S.get("lang", "en-us")
SAY = S.get("pronounce", {})          # regex -> spoken spelling, e.g. {"\\bGIF\\b": "gif"}
FPS = int(S.get("fps", 30))
R = 24000
KO = Path(os.environ.get("KOKORO_HOME") or Path.home() / "kokoro")
MODEL = Path(os.environ.get("KOKORO_MODEL") or KO / "kokoro-v1.0.onnx")
VOICES = Path(os.environ.get("KOKORO_VOICES") or KO / "voices-v1.0.bin")
for f in (MODEL, VOICES):
    if not f.is_file(): die(f"Kokoro model file not found: {f}\n  Download kokoro-v1.0.onnx and voices-v1.0.bin (see README.md) or set KOKORO_HOME.")
CACHE = OUT / ".voice-cache"; CACHE.mkdir(parents=True, exist_ok=True)
MEASURE = os.environ.get("AVATAR_TIMING", "model") != "estimate" and hasattr(Kokoro, "create_timed")
_kokoro = None; _tokenizer = None; WHY_ESTIMATED = set()
if not MEASURE: WHY_ESTIMATED.add("AVATAR_TIMING=estimate" if hasattr(Kokoro, "create_timed") else "this kokoro-onnx cannot report timings (0.6 or newer can)")


def kokoro():
    """The voice model, loaded only when something new must be spoken. When word times are measured it is
    loaded with its phoneme durations exposed as a second output (the model file itself is not changed)."""
    global _kokoro
    if _kokoro is not None: return _kokoro
    if MEASURE:
        try:
            import onnxruntime as ort, word_timing
            from kokoro_onnx.session import resolve_providers
            sess = ort.InferenceSession(word_timing.expose_durations(MODEL.read_bytes()), providers=resolve_providers())
            sess._model_path = str(MODEL)  # from_session reads the path from here; a session made from bytes has none
            _kokoro = Kokoro.from_session(sess, str(VOICES))
            if not _kokoro.has_timings: raise ValueError("the model gave no duration output")
            return _kokoro
        except Exception as e:  # a different model or library version: fall back to the plain model and estimates
            WHY_ESTIMATED.add(f"the model's durations could not be read ({e})")
    _kokoro = Kokoro(str(MODEL), str(VOICES))
    return _kokoro


def speak(text, voice, speed):
    """One phrase as (float32 samples, timing). timing is {"ph": phonemes, "starts": [seconds per phoneme]} or None.
    Both are cached on disk by text, voice, speed and language."""
    key = hashlib.sha1(json.dumps([text, voice, speed, LANG, MODEL.name], ensure_ascii=False).encode()).hexdigest()
    hit, thit = CACHE / f"{key}.npy", CACHE / f"{key}.timing.json"
    if hit.is_file() and not MEASURE: return np.load(hit), None
    if hit.is_file() and thit.is_file(): return np.load(hit), json.loads(thit.read_text(encoding="utf-8"))
    k = kokoro(); timing = None
    if MEASURE and getattr(k, "has_timings", False):
        ph = k.tokenizer.phonemize(text, LANG)
        if 0 < len(ph) <= 510:  # one batch: the same audio as create() gives, plus when each phoneme starts
            audio, _, marks = k.create_timed(ph, voice=voice, speed=speed, lang=LANG, is_phonemes=True, sentence_pause=0, clause_pause=0)
            if len(marks) == len(ph): timing = {"ph": ph, "starts": [round(m.start, 4) for m in marks]}
        else: audio, _ = k.create(text, voice=voice, speed=speed, lang=LANG)
    else: audio, _ = k.create(text, voice=voice, speed=speed, lang=LANG)
    y = audio.astype(np.float32); np.save(hit, y)
    if MEASURE: thit.write_text(json.dumps(timing, ensure_ascii=False), encoding="utf-8")
    return y, timing


def spoken(text):
    for a, b in SAY.items(): text = re.sub(a, b, text)
    return text


def word_phonemes(word):
    """Phonemes of one written word said on its own (after the pronunciation fixes). Cached on disk."""
    global _tokenizer
    cache = CACHE / "word-phonemes.json"
    if not hasattr(word_phonemes, "known"):
        try: word_phonemes.known = json.loads(cache.read_text(encoding="utf-8"))
        except (OSError, ValueError): word_phonemes.known = {}
    key = f"{LANG}|{spoken(word)}"
    if key not in word_phonemes.known:
        if _tokenizer is None:
            from kokoro_onnx.tokenizer import Tokenizer
            _tokenizer = _kokoro.tokenizer if _kokoro is not None else Tokenizer()
        word_phonemes.known[key] = _tokenizer.phonemize(spoken(word), LANG)
        word_phonemes.dirty = True
    return word_phonemes.known[key]


def measured(words, timing, cut, length):
    """Start of each word in seconds from the start of the trimmed phrase, or None to fall back to an estimate."""
    if not timing: return None
    try:
        import word_timing
        starts = word_timing.word_starts([word_phonemes(w) for w in words], timing["ph"], timing["starts"], cut + length)
    except Exception as e:
        WHY_ESTIMATED.add(f"words could not be lined up ({e})"); return None
    if starts is None: return None
    out, low = [], 0.0
    for s in starts: low = min(length, max(low, s - cut)); out.append(low)
    return out


def trim(x, thr=0.01, pad=0.02):
    """x without its leading and trailing silence, and how many seconds were cut from the front"""
    env = np.convolve(np.abs(x), np.ones(240) / 240, "same")
    idx = np.where(env > thr)[0]
    if len(idx) == 0: return x, 0.0
    a = max(0, idx[0] - int(pad * R))
    return x[a:min(len(x), idx[-1] + int(pad * R))], a / R


def syl(w):
    w = re.sub(r"[^a-z]", "", w.lower())
    if not w: return 1
    return max(1, len(re.findall(r"[aeiouy]+", w)) - (1 if w.endswith("e") and len(w) > 3 else 0))


def split_phrases(words):
    out, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[,.?:;!]$", w): out.append(cur); cur = []
    if cur: out.append(cur)
    return out


def tokens(say):
    """written words of a line, and which were marked *like this* for emphasis"""
    out = []
    for raw in say.split():
        clean = raw.replace("*", "")
        if clean: out.append((clean, "*" in raw))
    return out


title = S.get("title") if isinstance(S.get("title"), dict) else None
end = S.get("end") if isinstance(S.get("end"), dict) else None
t = float(title.get("hold", 2.6)) if title else float(S.get("lead", 0.5))
title_end = t if title else 0.0
gap_default = float(S.get("gap", 0.45))
lines, clips, counted = [], [], {"model": 0, "estimate": 0}
for li, ln in enumerate(LINES):
    toks = tokens(str(ln["say"]))
    words = [w for w, _ in toks]
    phrases = split_phrases(words)
    parts, wt, pos = [], [], 0.0
    for pi, p in enumerate(phrases):
        raw, timing = speak(spoken(" ".join(p)), ln.get("voice", VOICE), float(ln.get("speed", SPEED)))
        y, cut = trim(raw)
        d = len(y) / R; tot = sum(syl(w) for w in p); acc = 0
        real = measured(p, timing, cut, d) if MEASURE else None
        counted["model" if real else "estimate"] += 1
        if real: wt += [round(pos + s, 3) for s in real]
        else:
            for w in p: wt.append(round(pos + acc / tot * d * 0.96, 3)); acc += syl(w)
        parts.append(y); pos += d
        if pi < len(phrases) - 1:
            gap = 0.26 if re.search(r"[.?!]$", p[-1]) else 0.12
            parts.append(np.zeros(int(gap * R), np.float32)); pos += gap
    x = np.concatenate(parts)
    dur = len(x) / R
    lines.append({"start": round(t, 3), "end": round(t + dur, 3),
                  "words": [{"w": w, "t": round(t + wt[n], 3), **({"em": True} if em else {})} for n, (w, em) in enumerate(toks)]})
    clips.append((t, x))
    print(f"line {li + 1:2d}  start {t:6.2f}  voice {dur:5.2f}s  {len(words)} words")
    t += dur + (float(ln.get("pause", gap_default)) if li < len(LINES) - 1 else 0)
voice_end = t
end_start = None
if end:
    end_start = round(voice_end + float(S.get("tail", 0.5)), 3)
    total = round(end_start + float(end.get("hold", 3.0)), 3)
else:
    total = round(voice_end + float(S.get("tail", 1.2)), 3)

if getattr(word_phonemes, "dirty", False): (CACHE / "word-phonemes.json").write_text(json.dumps(word_phonemes.known, ensure_ascii=False), encoding="utf-8")

n = int(round(total * R))
voice = np.zeros(n, np.float32)
for st, x in clips:
    s = int(st * R); voice[s:s + len(x)] += x[:max(0, n - s)]
voice = (voice / max(1.0, float(np.max(np.abs(voice))) / 0.97)).astype(np.float32)
sf.write(OUT / "voice.wav", voice, R)

# loudness of every video frame: RMS over a window of 1.5 frames centred on the frame's time
frames = int(round(total * FPS))
half = int(0.75 * R / FPS)
sq = np.concatenate([[0.0], np.cumsum(voice.astype(np.float64) ** 2)])
loud = []
for i in range(frames):
    c = int(round(i / FPS * R)); a, b = max(0, c - half), min(n, c + half)
    loud.append(round(float(np.sqrt((sq[b] - sq[a]) / max(1, b - a))), 5) if b > a else 0.0)

TIMING = "model" if not counted["estimate"] else "estimate" if not counted["model"] else "mixed"
TIMELINE = {"version": 1, "total": total, "fps": FPS, "timing": TIMING, "titleEnd": round(title_end, 3),
            "voiceEnd": round(voice_end, 3), "endStart": end_start, "lines": lines, "loudness": loud,
            "source": hashlib.sha1(SCRIPT.read_bytes()).hexdigest()}
(OUT / "timeline.json").write_text(json.dumps(TIMELINE), encoding="utf-8")
print("word times:", {"model": "from the model's phoneme durations", "estimate": "estimated from syllable counts", "mixed": f"from the model for {counted['model']} phrase(s), estimated for {counted['estimate']}"}[TIMING]
      + (f"  ({'; '.join(sorted(WHY_ESTIMATED))})" if WHY_ESTIMATED else ""))
print(f"total {total}s, {frames} frames at {FPS} fps -> {OUT / 'timeline.json'}")
