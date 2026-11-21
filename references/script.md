# script.json

One file per project. Everything is optional except `lines` and `character.likeness`. `avatar lint <dir>` checks it, and `sheet`, `stills`, `video` and `build` refuse to render while it reports errors.

```json
{
  "format": "landscape",
  "head": "head",
  "character": { "name": "Juno", "role": "Example character", "likeness": "original" },
  "label": "Computer-generated character",
  "title": { "kicker": "avatar-studio", "text": "Meet Juno", "sub": "One line under the title.", "hold": 2.6 },
  "panel": "How this video was made",
  "lines": [
    { "say": "Hi, I'm Juno." },
    { "say": "This started from one portrait.", "points": [{ "text": "One portrait", "at": "portrait" }] },
    { "say": "Every frame renders the *same* way.", "pause": 0.6 }
  ],
  "end": { "text": "One drawing, one script", "sub": "Made with avatar-studio.", "hold": 3 },
  "lowerThird": { "line": 0, "after": 0.3, "for": 4 },
  "colors": { "bg": "#EFE7DA", "stage": "#E2D5C1", "ink": "#1D2433", "soft": "#5B6170", "accent": "#C8452B", "card": "#FBF7F0",
              "caption": "#1D2433", "captionText": "#FBF7F0", "captionWord": "#FFB59E" },
  "voice": "af_heart", "speed": 1.0, "lang": "en-us",
  "pronounce": { "\\bGIF\\b": "gif" },
  "captions": true, "captionWords": 5,
  "fps": 30, "seed": 7, "lead": 0.5, "gap": 0.45, "tail": 0.5, "poster": 21.5,
  "mouth": { "range": 30, "most": 0.92, "attack": 0.7, "release": 0.45, "lead": 1 }
}
```

| Field | Meaning |
|---|---|
| `format` | `landscape` (1920x1080), `vertical` (1080x1920) or `square` (1080x1080). `--format` overrides it for one run. |
| `head` | folder inside the project (relative, no `..`, not a link to elsewhere) holding `head.glb` and `head.json` from talking-head. Default `head`. |
| `character` | **required** `likeness`, your declaration of where the face comes from: `original` (invented), `licensed`, or `real-person-with-consent` (then `"consent": true` is required too, set only after the person agreed). `name` (up to 40 characters) and `role` (up to 64) fill the name strap; longer text is shrunk, then cut with "…" and reported. |
| `label` | the on-screen note on every frame. It cannot be empty, must be at most 48 characters (it is shrunk or wrapped to fit the frame), and should say the character is computer-generated. |
| `title` | a title card at the start, beside the character, before the first line. `hold` is its length in seconds (default 2.6). |
| `panel` | the heading of the side panel. The panel opens with the first point and stays until the end card. |
| `lines[].say` | words to speak. Punctuation makes pauses and caption breaks. `*word*` marks a stressed word: the head nods on it (lines with no mark nod on their loudest long word). |
| `lines[].points` | `{ "text", "at" }`: a point that appears in the side panel when the word `at` (the first word starting with it, in this line) is said. At most 5 in landscape, 4 in vertical and square. |
| `lines[].pause` | silence after this line (default `gap`, 0.45 s). `voice`, `speed` per line are allowed. |
| `end` | an end card after the last line, for `hold` seconds (default 3). It adds "The character and the voice are computer-generated." |
| `lowerThird` | `false` to hide the name strap; else which line it shows on (`line`, 0-based), how long after that line starts (`after`) and for how long (`for`). |
| `colors` | any of the colours above (#rrggbb). Lint warns when text would be hard to read. |
| `voice`, `speed`, `lang` | Kokoro voice (`af_heart`, `af_bella`, `am_michael`, `bf_emma`, `bm_george`, ...), speed 0.5 to 2, language code. |
| `pronounce` | regular expression to spoken spelling, applied before speaking (captions keep the written words). |
| `captions`, `captionWords` | burn captions in (default true; `--no-captions` for one run) and the most words in one caption. `.vtt` and `.srt` are always written. |
| `fps`, `seed` | frame rate (24, 25, 30, 60) and the seed for blinks and sway (default: from the lines' text). |
| `lead`, `gap`, `tail` | silence before the first line when there is no title, between lines, and after the last line. |
| `poster` | seconds of the frame used as the poster image (default: the side panel full, mouth a little open). |
| `mouth` | tuning of the loudness-to-mouth mapping (`engine/lib/envelope.mjs`): `range` dB from shut to open, `most` widest opening, `attack`/`release` per-frame smoothing, `lead` frames the mouth runs ahead of the sound. |
