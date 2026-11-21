// Caption files (.vtt and .srt) from the plan's caption chunks. Pure.
const pad = (n, w = 2) => String(n).padStart(w, '0')

/** seconds -> "HH:MM:SS.mmm" (WebVTT) or "HH:MM:SS,mmm" (SRT) */
export function stamp(sec, sep = '.') {
  const ms = Math.max(0, Math.round(sec * 1000))
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`
}
const text = (c) => c.words.map((w) => w.w).join(' ')
export const toVtt = (chunks) => 'WEBVTT\n\n' + chunks.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${text(c)}\n`).join('\n')
export const toSrt = (chunks) => chunks.map((c, i) => `${i + 1}\n${stamp(c.from, ',')} --> ${stamp(c.to, ',')}\n${text(c)}\n`).join('\n')
