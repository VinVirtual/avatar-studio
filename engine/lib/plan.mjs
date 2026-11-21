// The plan: script + timeline (from the voice) + layout, turned into everything a frame needs, with times.
// Built once in Node and handed to the render page, which draws any frame from it alone. Pure.
import { layoutFor } from './layout.mjs'
import { mouthTrack } from './envelope.mjs'
import { blinkSchedule, activity, smooth } from './motion.mjs'
import { seedOf } from './rng.mjs'

export const DEFAULT_COLORS = { bg: '#EFE7DA', stage: '#E2D5C1', ink: '#1D2433', soft: '#5B6170', accent: '#C8452B', card: '#FBF7F0', caption: '#1D2433', captionText: '#FBF7F0', captionWord: '#FFB59E' }
export const DEFAULT_LABEL = 'Computer-generated character'
export const MOVE = { before: 0.35, length: 0.7, merge: 2.4 }

/** a word with its punctuation and case taken off, for matching */
export const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/** index of the first word in `words` (strings) that starts with `at`'s first word, or -1 */
export function matchWord(words, at) {
  const k = norm(String(at || '').split(/\s+/)[0])
  if (!k) return -1
  return words.findIndex((w) => norm(w).startsWith(k))
}

/** the written words of a line with the *emphasis* marks taken off */
export const lineWords = (say) => String(say || '').split(/\s+/).map((w) => w.replace(/\*/g, '')).filter(Boolean)

/** split at punctuation, long phrases into balanced groups, never leave a one-word orphan (from reel-studio) */
export function captionGroups(words, maxWords = 5) {
  const phrases = [], groups = [], out = []
  let cur = []
  for (const w of words) { cur.push(w); if (/[,.?:;!]$/.test(w.w ?? w)) { phrases.push(cur); cur = [] } }
  if (cur.length) phrases.push(cur)
  for (const p of phrases) {
    const n = Math.ceil(p.length / maxWords), size = Math.ceil(p.length / n)
    for (let i = 0; i < p.length; i += size) groups.push(p.slice(i, i + size))
  }
  for (const g of groups) {
    const last = out[out.length - 1]
    if (last && (g.length === 1 || last.length === 1) && last.length + g.length <= maxWords + 1) out[out.length - 1] = [...last, ...g]
    else out.push(g)
  }
  return out
}

/** caption cues: [{ from, to, words: [{ w, t }] }]; each lasts until the next starts or just after its line ends */
export function captionChunks(timeline, maxWords = 5, linger = 0.35) {
  const flat = timeline.lines.flatMap((line) => captionGroups(line.words, maxWords).map((words) => ({ words, lineEnd: line.end })))
  return flat.map((c, i) => {
    const from = c.words[0].t, next = flat[i + 1] ? flat[i + 1].words[0].t : Infinity
    return { from, to: +Math.min(next, Math.max(c.lineEnd + linger, from + 0.4)).toFixed(3), words: c.words.map(({ w, t }) => ({ w, t })) }
  })
}

/** points with the time of the word they appear on: [{ text, t, line }] in order of time */
export function pointTimes(script, timeline) {
  const out = []
  ;(script.lines || []).forEach((line, li) => {
    const tl = timeline.lines[li]
    for (const p of line.points || []) {
      const i = matchWord(tl.words.map((w) => w.w), p.at)
      out.push({ text: String(p.text), t: i >= 0 ? tl.words[i].t : tl.start, line: li })
    }
  })
  return out.sort((a, b) => a.t - b.t)
}

/** spans of time when the head stands aside, joined when the gap between them is shorter than `merge` */
export function asideSpans(spans, merge = MOVE.merge) {
  const sorted = spans.filter((s) => s && s.to > s.from).map((s) => ({ from: s.from, to: s.to })).sort((a, b) => a.from - b.from)
  const out = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.from - last.to < merge) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

/** how far the head has moved aside at t (0 to 1, eased). It starts moving just before a span begins. */
export function asideAt(spans, t, total = Infinity) {
  let p = 0
  for (const s of spans) {
    const start = s.from <= 0.01 ? -1 : s.from - MOVE.before
    const inP = smooth((t - start) / MOVE.length)
    const outP = s.to >= total - 0.01 ? 0 : smooth((t - s.to) / MOVE.length)
    p = Math.max(p, Math.min(inP, 1 - outP))
  }
  return p
}

/** Nods: on words marked *like this*; where a line has none, on its loudest long word. At least `gap` seconds apart. */
export function nodTimes(timeline, loudness, fps, gap = 1.2) {
  const loudAt = (t) => { const a = Math.round(t * fps), b = Math.round((t + 0.25) * fps); let s = 0, n = 0; for (let i = a; i <= b && i < loudness.length; i++) { s += loudness[i]; n++ } return n ? s / n : 0 }
  const picks = []
  for (const line of timeline.lines) {
    const marked = line.words.filter((w) => w.em)
    if (marked.length) picks.push(...marked.map((w) => w.t))
    else if (line.words.length >= 5) {
      const long = line.words.filter((w) => norm(w.w).length >= 4)
      const best = (long.length ? long : line.words).reduce((a, b) => (loudAt(b.t) > loudAt(a.t) ? b : a))
      picks.push(best.t)
    }
  }
  const out = []
  for (const t of picks.sort((a, b) => a - b)) if (!out.length || t - out[out.length - 1] >= gap) out.push(t)
  return out
}

/** Everything in the script that changes the voice or the timing (gen_audio.py stores the same object in the timeline). */
export function audioInputs(script) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null), v = (x) => (x === undefined ? null : x)
  const t = obj(script.title), e = obj(script.end)
  return {
    lines: (Array.isArray(script.lines) ? script.lines : []).map((l) => ({ say: v(l?.say), pause: v(l?.pause), voice: v(l?.voice), speed: v(l?.speed) })),
    voice: v(script.voice), speed: v(script.speed), lang: v(script.lang), pronounce: v(script.pronounce),
    fps: v(script.fps), lead: v(script.lead), gap: v(script.gap), tail: v(script.tail),
    title: t ? { hold: v(t.hold) } : null, end: e ? { hold: v(e.hold) } : null,
  }
}

/** structural equality of JSON values (numbers compared as numbers, key order ignored) */
export function sameJson(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]))
}

/** Problems with using `timeline` for `script`: { stale: [fields that changed since the voice was made], warnings: [...] } */
export function timelineCheck(script, timeline) {
  const now = audioInputs(script), then = timeline?.inputs
  const stale = !then ? ['version'] : Object.keys(now).filter((k) => !sameJson(now[k], then[k]))
  const warnings = []
  if (script.title?.text && !(timeline?.titleEnd > 0)) warnings.push('the script has a title but the voice was made without one: the title will not show')
  if (script.end?.text && timeline?.endStart == null) warnings.push('the script has an end card but the voice was made without one: the end card and its computer-generated note will not show')
  if (timeline && timeline.timing !== 'model') warnings.push(`word times were ${timeline.timing === 'mixed' ? 'partly ' : ''}estimated, not measured from the voice model: points, captions and nods may land a little early or late`)
  return { stale, warnings }
}

/** the moments worth one frame each on the review sheet */
export function beats(plan) {
  const out = []
  if (plan.title) out.push({ t: +(plan.title.to * 0.6).toFixed(2), label: 'title' })
  plan.lines.forEach((line, i) => {
    const a = Math.round(line.start * plan.fps), b = Math.round(line.end * plan.fps)
    let best = a
    for (let f = a; f <= b && f < plan.mouth.length; f++) if (plan.mouth[f] > plan.mouth[best]) best = f
    out.push({ t: +(best / plan.fps).toFixed(2), label: `line ${i + 1}, mouth open` })
  })
  if (plan.lowerThird) out.push({ t: +Math.min(plan.lowerThird.to - 0.5, plan.lowerThird.from + 1.2).toFixed(2), label: 'name strap' })
  if (plan.panel) plan.panel.points.forEach((p, i) => out.push({ t: +(p.t + 0.8).toFixed(2), label: `point ${i + 1}` }))
  const blink = plan.motion.blinks.find((b) => !plan.title || b.at > plan.title.to)
  if (blink) out.push({ t: +(blink.at + blink.length * 0.4).toFixed(2), label: 'blink' })
  if (plan.end) out.push({ t: +Math.min(plan.total - 0.05, plan.end.from + 1.2).toFixed(2), label: 'end card' })
  return out.sort((a, b) => a.t - b.t)
}

/** Everything the page needs. `surface` is the head's head.json (for how far it may turn). */
export function makePlan(script, timeline, { format, captions, surface = {} } = {}) {
  const L = layoutFor(format || script.format || 'landscape'), fps = timeline.fps, total = timeline.total
  const seed = Number.isInteger(script.seed) ? script.seed : seedOf(JSON.stringify(script.lines))
  const mouth = mouthTrack(timeline.loudness, script.mouth || {})
  const title = script.title && script.title.text ? { kicker: script.title.kicker || '', text: script.title.text, sub: script.title.sub || '', from: 0, to: timeline.titleEnd } : null
  const end = script.end && script.end.text && timeline.endStart != null ? { text: script.end.text, sub: script.end.sub || '', from: timeline.endStart, to: total } : null
  const points = pointTimes(script, timeline)
  const panel = points.length ? { heading: script.panel || '', from: points[0].t, to: end ? end.from : total, points } : null
  const who = script.character || {}
  const lt = script.lowerThird === false || !who.name ? null : (() => {
    const o = typeof script.lowerThird === 'object' && script.lowerThird ? script.lowerThird : {}
    const line = timeline.lines[Math.min(timeline.lines.length - 1, o.line ?? 0)]
    return { name: who.name, role: who.role || '', from: line.start + (o.after ?? 0.3), to: line.start + (o.after ?? 0.3) + (o.for ?? 4) }
  })()
  const spans = asideSpans([title, panel, end].filter(Boolean))
  const turn = Number.isFinite(surface.maxTurn) ? surface.maxTurn : 0.6
  const glanceDir = L.slot.x > L.W / 3 ? [1, 0] : [0, -1]
  const glances = panel ? [{ t: points[0].t, dir: glanceDir }, ...points.slice(1).filter((p, i) => p.t - points[i].t > 3).map((p) => ({ t: p.t, dir: glanceDir }))].map((g) => ({ ...g, t: +g.t.toFixed(3) })) : []
  const plan = {
    version: 1, format: L.format, W: L.W, H: L.H, fps, total, seed,
    colors: { ...DEFAULT_COLORS, ...(script.colors || {}) },
    label: script.label || DEFAULT_LABEL,
    captions: captions ?? script.captions !== false,
    title, end, panel, lowerThird: lt, lines: timeline.lines,
    chunks: captionChunks(timeline, script.captionWords || 5),
    aside: spans, mouth,
    motion: { seed, fps, turn, blinks: blinkSchedule(seed, total), nods: nodTimes(timeline, timeline.loudness, fps), glances,
      activity: activity(mouth, fps), asideTurn: 0.08 * glanceDir[0] },
  }
  plan.beats = beats(plan)
  return plan
}
