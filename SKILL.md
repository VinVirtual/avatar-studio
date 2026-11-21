---
name: avatar-studio
description: Turn ONE illustrated portrait (a cartoon or drawn character) plus a script into a finished MP4 of that character speaking it, made entirely on this machine. Builds or reuses a talking-head 3D head, voices the script locally with Kokoro, drives blinks, head sway, nods and the mouth from the real audio, and renders frames deterministically in headless Chrome, with burned-in captions, a computer-generated label, and an optional title, name strap, side panel of points that appear on spoken words, and end card. Landscape, vertical or square. Use whenever the user wants a talking avatar video, an animated presenter or mascot explaining something, a "character reads my script" clip, a talking-head explainer for social media or a web page, or to re-voice, re-cut or reformat a video made this way. Not for photos of real people without their consent, impersonation, deepfakes or lip-sync to phonemes.
---

# avatar-studio

Pipeline: **head** (talking-head: portrait to `head.glb` + `head.json`) → **audio** (Kokoro voice, measured word times, loudness of every frame) → **plan** (mouth from loudness, seeded blinks and sway, nods on stressed words, glances at the side panel, layout over time) → **render** (every frame a pure function of t, drawn in headless Chrome, piped to ffmpeg) → MP4 + captions + web copy.

Skill folder: `~/.claude/skills/avatar-studio/` (written `$A` below). Every command is `$A/avatar <command> <project>`. `$A/avatar help` lists them. It needs the **talking-head** skill installed (default `~/.claude/skills/talking-head`; set `TALKING_HEAD_DIR` to use another folder).

```
$A/avatar                  the command line (check, new, lint, head, audio, sheet, stills, video, build, test)
$A/engine/gen_audio.py     voice, word times, per-frame loudness (run by "avatar audio")
$A/engine/lib/             pure, unit-tested modules: envelope (mouth), motion, layout, plan, lint, captions
$A/engine/page/frame.js    draws one frame: background, head (talking-head's viewer), title, panel, captions, label
$A/references/script.md    every script field
$A/examples/juno/          a finished example (Juno, a fictional character from talking-head)
```

## Before anything: the rules for faces and words

These are not optional. Say them to the user when they apply.

1. **Whose face is it?** If the portrait shows or is drawn from a real person, that person must have agreed to this use. Ask the user. If they cannot confirm consent, stop. Never make a video of a public figure, a colleague, an ex, a child, or anyone the user cannot speak for. In the script set `"character": { "likeness": "real-person-with-consent", "consent": true }` only after the user confirms; otherwise `"likeness": "original"` (an invented character) or `"licensed"`.
2. **Never impersonate.** The character must not pretend to be a real person, and the script must not put words in a real person's mouth or present lines as someone's real statements, quotes, endorsements or apologies. If the user asks for that, decline that part and offer an original character or a clearly fictional framing.
3. **Label it.** Every frame carries an on-screen label (default "Computer-generated character"; lint refuses an empty one) and the end card says the character and voice are computer-generated. Tell the user to keep a similar note wherever they post the video (caption, description, page text), and to follow the platform's rules for synthetic media.
4. **List the claims.** Before rendering, list every factual claim the script makes (numbers, product capabilities, prices, dates, comparisons, health/legal/financial statements) and ask the user to confirm each one. The character says it in a confident voice; the user is the one who stands behind it.
5. **Nothing leaves the machine** except with the user's yes: `avatar head --source space` uploads the portrait to a public Hugging Face Space and needs `--yes` after the user agreed (talking-head's SKILL.md explains the licence limits). The voice, frames and video are all made locally.

## Workflow

1. **Check**: `$A/avatar check`. It says how to fix what is missing (talking-head, three.js, Kokoro, ffmpeg, Playwright, a browser with WebGL).
2. **Start**: `$A/avatar new <dir> --portrait picture.png` (a head will be built) or `--head <folder with head.glb and head.json>` (reuse one, such as `$A/examples/juno/head`).
3. **Head** (only with a portrait): `$A/avatar head <dir>`. Runs talking-head (`new`, `mark --auto`, `shape --source inflate`, `build`, `preview`) in `<dir>/build/head` and copies the result to `<dir>/head/`. If the portrait changed since its marks were made it stops: rerun with `--force` (new automatic marks) or `--marks FILE`. One Blender process at a time; it takes a minute or two. Then **Read** `<dir>/build/head/out/preview.png` and judge it as talking-head's SKILL.md says (eyes covered on blink, mouth opening on the lip line). Fix marks with talking-head's `mark --page`, or pass `--marks FILE`, and run `avatar head` again.
4. **Script**: edit `<dir>/script.json` (fields in `references/script.md`). Keep lines to one or two sentences. Points are 2 to 6 words and hang on a word said in the same line (`"at": "word"`). Mark one stressed word per sentence like `*this*` for a nod. Then `$A/avatar lint <dir>` until there are no errors (`sheet`, `stills`, `video` and `build` run lint themselves and refuse to render with errors: no `character.likeness`, a real person without `consent: true`, an empty or over-long label, a head folder outside the project). Do rule 4 (list the claims) now.
5. **Voice**: `$A/avatar audio <dir>`. Run it again after changing anything that shapes the voice or timing (lines, voice, speed, lang, pronounce, fps, lead, gap, tail, pause, adding or changing a title or end card); the render commands refuse an out-of-date voice and say so. It prints each line's start and length and whether word times were measured from the model ("from the model's phoneme durations") or estimated; with estimated times the render commands warn that points and captions may land slightly off. Aim for 20 to 60 seconds.
6. **Look**: `$A/avatar sheet <dir>`, then **Read** `stills/<name>-sheet.png` (one frame per beat: title, each line at its widest mouth, each point, a blink, the end card). Any `layout:` lines it prints are text that did not fit: shorten it. Check: no text over the face, captions readable and not over the mouth, panel text inside its rows, the label visible, nothing cut at the frame edge. For detail use `$A/avatar stills <dir> 4.2 11` and Read those PNGs. Never say it looks right without viewing it.
7. **Render**: `$A/avatar video <dir> --web` (or `avatar build <dir>` for lint + audio + sheet + video + web + looping preview). It prints a **sync** line measured from the finished file: the correlation `r` between the mouth that was drawn and the sound energy decoded back out of the MP4, and the best lag in frames. Expect r above 0.75 and a lag of 0 or -1 (the mouth leads by one frame on purpose). Report these numbers; you cannot hear the audio.
8. **Other shapes**: `--format vertical` or `--format square` on `sheet`, `stills`, `video` and `build`. Files get `-<format>` in their names. Look at the sheet again for each shape.
9. **Tell the user** where the files are (`out/<name>.mp4`, `.vtt`, `.srt`, `out/web/`), the sync numbers, the limits below, and rules 3 and 4.

## What to expect, honestly

- The mouth follows **loudness**, not phonemes: it opens on loud sounds and closes in pauses. Good for cartoons, not lip-reading.
- Only illustrated, front-facing heads work well (talking-head's limits apply: puffy profile with the offline shape, plain sides past about 35 degrees). Head turns are kept small for that reason.
- One voice per video in practice (a line may set its own `voice`, but there is one character on screen).
- Rendering is software WebGL: about 4 to 5 frames a second with 2 pages, so a 30-second landscape video takes around 3 minutes.

## Rules

- At most 2 browser pages (`--workers 1|2`) and one Blender process at a time.
- Do not commit a project's `build/`, `stills/` or `out/` folders unless the user wants the renders kept.
- After changing anything in `engine/lib/`, run `$A/avatar test`.
