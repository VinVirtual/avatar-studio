// Where everything sits in the frame, for each format. Plain numbers in pixels of the full-size frame
// (the short side is always 1080). Pure; runs in Node and in the render page.

export const FORMATS = {
  landscape: {
    W: 1920, H: 1080, margin: 88,
    head: { solo: { cx: 960, size: 920, bottom: 1110 }, aside: { cx: 560, size: 880, bottom: 1110 } },
    slot: { x: 1040, y: 190, w: 792, h: 660 },
    captions: { bottom: 1012, maxW: 820, size: 44 },
    lowerThird: { x: 88, y: 742, w: 560, h: 112 },
    type: { title: 112, sub: 36, kicker: 26, point: 42, number: 62, end: 96, label: 26 },
    capacity: 5, fade: 0,
  },
  vertical: {
    W: 1080, H: 1920, margin: 72,
    head: { solo: { cx: 540, size: 1040, bottom: 1710 }, aside: { cx: 540, size: 920, bottom: 1730 } },
    slot: { x: 80, y: 200, w: 920, h: 600 },
    captions: { bottom: 1660, maxW: 880, size: 50 },
    lowerThird: { x: 72, y: 1690, w: 600, h: 112 },
    type: { title: 112, sub: 38, kicker: 28, point: 44, number: 62, end: 100, label: 28 },
    capacity: 4, fade: 0.2,
  },
  square: {
    W: 1080, H: 1080, margin: 64,
    head: { solo: { cx: 540, size: 860, bottom: 1110 }, aside: { cx: 296, size: 720, bottom: 1110 } },
    slot: { x: 584, y: 150, w: 436, h: 640 },
    captions: { bottom: 1020, maxW: 900, size: 38 },
    lowerThird: { x: 64, y: 790, w: 440, h: 100 },
    type: { title: 72, sub: 28, kicker: 21, point: 31, number: 46, end: 64, label: 22 },
    capacity: 4, fade: 0,
  },
}
export const FORMAT_NAMES = Object.keys(FORMATS)

const lerp = (a, b, p) => a + (b - a) * p

/** the format's layout; throws on an unknown name */
export function layoutFor(format = 'landscape') {
  const L = FORMATS[format]
  if (!L) throw new Error(`unknown format "${format}": use ${FORMAT_NAMES.join(', ')}`)
  return { format, ...L }
}

/** The head's square on the frame when it is `p` of the way (0 to 1, already eased) from the middle to the side. */
export function headBox(L, p) {
  const a = L.head.solo, b = L.head.aside
  const size = lerp(a.size, b.size, p), cx = lerp(a.cx, b.cx, p), bottom = lerp(a.bottom, b.bottom, p)
  return { x: cx - size / 2, y: bottom - size, size, cx }
}

/** The caption box: centred under the head, as wide as the text needs, never past the frame's margins. */
export function captionBox(L, cx, textW, lines = 1) {
  const pad = Math.round(L.captions.size * 0.55), lineH = Math.round(L.captions.size * 1.28)
  const w = Math.min(L.captions.maxW, textW, L.W - 2 * L.margin - pad * 2) + pad * 2, h = lines * lineH + pad * 1.2
  const x = Math.min(L.W - L.margin - w, Math.max(L.margin, cx - w / 2))
  return { x, y: L.captions.bottom - h, w, h, pad, lineH }
}

/** The side panel for `count` points: a heading line, then equal rows, the whole block centred in the slot. */
export function panelRows(L, count = L.capacity) {
  const s = L.slot, n = Math.max(1, Math.min(count, L.capacity)), heading = Math.round(L.type.kicker * 2.8)
  const rowH = Math.min(L.type.point * 3.3, (s.h - heading) / n), top = s.y + (s.h - heading - rowH * n) / 2
  return { heading: { x: s.x, y: top, h: heading }, rows: Array.from({ length: n }, (_, i) => ({ x: s.x, y: top + heading + i * rowH, w: s.w, h: rowH })) }
}

/** do two rectangles overlap? */
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Greedy word wrap with a width function; returns lines of text. */
export function wrapWords(text, maxW, widthOf) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (cur && widthOf(next) > maxW) { lines.push(cur); cur = w } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}
