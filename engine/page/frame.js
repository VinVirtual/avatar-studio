// The render page. setup(plan, head) loads fonts and the talking head; grab(t) draws the frame at time t and
// returns it as an image. Every frame depends only on the plan and t, so frames can be drawn in any order.
import { createTalkingHead } from '/viewer/viewer.js'
import { layoutFor, headBox, captionBox, panelRows, wrapWords } from '/lib/layout.mjs'
import { poseAt, smooth } from '/lib/motion.mjs'
import { mouthAt } from '/lib/envelope.mjs'
import { asideAt } from '/lib/plan.mjs'
import { seeded } from '/lib/rng.mjs'

const DISPLAY = '"Display", Georgia, serif'
const BODY = '"Body", system-ui, sans-serif'
const S = { problems: new Set() }

const fade = (t, from, to, inFor = 0.45, outFor = 0.35) => Math.min(smooth((t - from) / inFor), 1 - smooth((t - (to - outFor)) / outFor))
const font = (weight, size, family = BODY) => `${weight} ${Math.round(size)}px ${family}`
const problem = (m) => S.problems.add(m)

function rgba(hex, a) {
  let h = hex.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r) }

/** text wrapped to `maxW`; reports when it needs more than `maxLines` */
function lines(ctx, text, maxW, maxLines, where) {
  const out = wrapWords(text, maxW, (s) => ctx.measureText(s).width)
  if (out.length > maxLines) problem(`${where}: "${text}" needs ${out.length} lines, room for ${maxLines}. Shorten it.`)
  if (out.some((l) => ctx.measureText(l).width > maxW + 1)) problem(`${where}: a word in "${text}" is wider than its box`)
  return out
}

function tracked(ctx, text, x, y, spacing) { ctx.letterSpacing = `${spacing}px`; ctx.fillText(text, x, y); ctx.letterSpacing = '0px' }

async function loadFonts() {
  const faces = [new FontFace('Display', 'url(/fonts/InstrumentSerif-Regular.ttf)'), new FontFace('Body', 'url(/fonts/Geist.ttf)', { weight: '100 900' })]
  for (const f of faces) document.fonts.add(await f.load())
}

/** a tile of fine paper grain, the same every run */
function grainTile(seed) {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d'), img = g.createImageData(256, 256), r = seeded(seed)
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
  g.putImageData(img, 0, 0)
  return c
}

window.setup = async (plan, head) => {
  S.plan = plan; S.L = layoutFor(plan.format); S.C = plan.colors
  await loadFonts()
  const out = document.getElementById('frame'); out.width = plan.W; out.height = plan.H
  S.out = out; S.ctx = out.getContext('2d')
  const size = Math.max(S.L.head.solo.size, S.L.head.aside.size)
  const hc = document.getElementById('head'); hc.style.width = hc.style.height = `${size}px`
  S.bust = document.createElement('canvas'); S.bust.width = S.bust.height = size
  S.head = createTalkingHead(hc, { model: `/project/${head}/head.glb`, surface: `/project/${head}/head.json`, animate: false, followPointer: false })
  S.headCanvas = hc
  await S.head.ready
  S.grain = S.ctx.createPattern(grainTile(plan.seed), 'repeat')
  return { W: plan.W, H: plan.H }
}

function background(ctx, box) {
  const { L, C } = S
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, L.W, L.H)
  // a big soft disc of the stage colour behind the head, with a ring: the "set"
  const cx = box.cx, cy = box.y + box.size * 0.42, r = box.size * 0.43
  const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r)
  g.addColorStop(0, rgba(C.stage, 0.65)); g.addColorStop(1, C.stage)
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = rgba(C.ink, 0.14); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r + 22, 0, Math.PI * 2); ctx.stroke()
  ctx.save(); ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = S.grain; ctx.fillRect(0, 0, L.W, L.H); ctx.restore()
}

function drawHead(ctx, box, pose, t) {
  S.head.renderPose(pose)
  const b = S.bust.getContext('2d'), n = S.bust.width
  b.clearRect(0, 0, n, n); b.drawImage(S.headCanvas, 0, 0, n, n) // straight after the render, while the drawing is there
  if (S.L.fade) {
    b.save(); b.globalCompositeOperation = 'destination-out'
    const g = b.createLinearGradient(0, n * (1 - S.L.fade), 0, n); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)')
    b.fillStyle = g; b.fillRect(0, n * (1 - S.L.fade), n, n * S.L.fade); b.restore()
  }
  const rise = 1 - smooth(t / 0.8)
  ctx.save()
  ctx.globalAlpha = 1 - rise
  ctx.shadowColor = rgba(S.C.ink, 0.22); ctx.shadowBlur = 36; ctx.shadowOffsetY = 18
  ctx.drawImage(S.bust, box.x, box.y + rise * 40, box.size, box.size)
  ctx.restore()
}

function kicker(ctx, text, x, y, size, color) {
  ctx.font = font(600, size); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'
  ctx.fillRect(x, y - size * 0.38, size * 1.6, 3)
  tracked(ctx, text.toUpperCase(), x + size * 2.3, y, size * 0.16)
}

function drawTitle(ctx, t) {
  const { plan, L, C } = S, T = plan.title
  if (!T || t > T.to) return
  const a = fade(t, T.from + 0.25, T.to, 0.55, 0.45)
  if (a <= 0) return
  const s = L.slot, ty = L.type
  ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 26)
  ctx.font = font(400, ty.title, DISPLAY)
  const head = lines(ctx, T.text, s.w, 3, 'title')
  ctx.font = font(400, ty.sub)
  const sub = T.sub ? lines(ctx, T.sub, s.w * 0.9, 3, 'title sub') : []
  const h = (T.kicker ? ty.kicker * 2.6 : 0) + head.length * ty.title * 1.0 + (sub.length ? ty.sub * 0.9 + sub.length * ty.sub * 1.35 : 0)
  let y = s.y + (s.h - h) / 2
  if (T.kicker) { kicker(ctx, T.kicker, s.x, y + ty.kicker, ty.kicker, C.accent); y += ty.kicker * 2.6 }
  ctx.font = font(400, ty.title, DISPLAY); ctx.fillStyle = C.ink
  for (const l of head) { y += ty.title * 0.92; ctx.fillText(l, s.x - 4, y); y += ty.title * 0.08 }
  if (sub.length) {
    y += ty.sub * 0.9; ctx.font = font(400, ty.sub); ctx.fillStyle = C.soft
    for (const l of sub) { y += ty.sub * 1.35; ctx.fillText(l, s.x, y) }
  }
  ctx.restore()
}

function drawPanel(ctx, t) {
  const { plan, L, C } = S, P = plan.panel
  if (!P || t < P.from - 0.1 || t > P.to) return
  const all = fade(t, P.from - 0.1, P.to, 0.35, 0.4)
  const { heading, rows } = panelRows(L, P.points.length), ty = L.type
  ctx.save(); ctx.globalAlpha = all
  if (plan.panel.heading) kicker(ctx, plan.panel.heading, heading.x, heading.y + ty.kicker * 1.2, ty.kicker, C.accent)
  const shown = P.points.filter((p) => t >= p.t)
  P.points.forEach((p, i) => {
    const row = rows[i]; if (!row) return
    const e = smooth((t - p.t) / 0.5); if (e <= 0) return
    const active = i === shown.length - 1
    const numW = ty.number * 1.45, textW = row.w - numW - 28
    ctx.font = font(500, ty.point)
    const text = lines(ctx, p.text, textW, 2, `point ${i + 1}`)
    const blockH = text.length * ty.point * 1.22
    const top = row.y + (row.h - blockH) / 2
    ctx.save(); ctx.globalAlpha = all * e; ctx.translate((1 - e) * 46, 0)
    if (active) {
      const glow = smooth((t - p.t) / 0.4)
      ctx.save(); ctx.globalAlpha = all * glow
      ctx.shadowColor = rgba(C.ink, 0.16); ctx.shadowBlur = 30; ctx.shadowOffsetY = 12
      ctx.fillStyle = C.card; roundRect(ctx, row.x - 22, row.y + 6, row.w + 30, row.h - 12, 18); ctx.fill()
      ctx.restore()
      ctx.fillStyle = C.accent; ctx.fillRect(row.x - 22, row.y + 6 + (row.h - 12) * 0.25, 5, (row.h - 12) * 0.5)
    } else if (i < shown.length - 1) {
      ctx.strokeStyle = rgba(C.ink, 0.12); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(row.x + numW, row.y + row.h - 1); ctx.lineTo(row.x + row.w, row.y + row.h - 1); ctx.stroke()
    }
    ctx.font = font(400, ty.number, DISPLAY); ctx.fillStyle = active ? C.accent : rgba(C.ink, 0.38)
    ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1).padStart(2, '0'), row.x, row.y + row.h / 2 + ty.number * 0.04)
    ctx.textBaseline = 'alphabetic'; ctx.font = font(active ? 560 : 460, ty.point); ctx.fillStyle = active ? C.ink : rgba(C.ink, 0.72)
    text.forEach((l, k) => ctx.fillText(l, row.x + numW, top + ty.point * (0.95 + k * 1.22)))
    ctx.restore()
  })
  ctx.restore()
}

function drawEnd(ctx, t) {
  const { plan, L, C } = S, E = plan.end
  if (!E || t < E.from) return
  const a = smooth((t - E.from) / 0.6), s = L.slot, ty = L.type
  ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 30)
  ctx.font = font(400, ty.end, DISPLAY)
  const head = lines(ctx, E.text, s.w, 3, 'end card')
  ctx.font = font(400, ty.sub)
  const sub = E.sub ? lines(ctx, E.sub, s.w, 3, 'end card sub') : []
  const h = head.length * ty.end + (sub.length ? ty.sub + sub.length * ty.sub * 1.35 : 0) + ty.kicker * 4
  let y = s.y + (s.h - h) / 2
  ctx.fillStyle = C.accent; ctx.fillRect(s.x, y, 64, 6); y += ty.kicker * 1.4
  ctx.font = font(400, ty.end, DISPLAY); ctx.fillStyle = C.ink
  for (const l of head) { y += ty.end * 0.95; ctx.fillText(l, s.x - 3, y); y += ty.end * 0.05 }
  if (sub.length) { y += ty.sub * 0.6; ctx.font = font(400, ty.sub); ctx.fillStyle = C.soft; for (const l of sub) { y += ty.sub * 1.35; ctx.fillText(l, s.x, y) } }
  ctx.font = font(500, ty.sub * 0.72); ctx.fillStyle = C.soft; y += ty.kicker * 1.4
  for (const l of lines(ctx, 'The character and the voice are computer-generated.', s.w, 2, 'end card note')) { y += ty.sub * 0.95; ctx.fillText(l, s.x, y) }
  ctx.restore()
}

function drawLowerThird(ctx, t, aside) {
  const { plan, L, C } = S, X = plan.lowerThird
  if (!X || t < X.from || t > X.to || aside >= 1) return
  const a = fade(t, X.from, X.to, 0.5, 0.35) * (1 - aside), r = L.lowerThird // it gives way when the head moves aside
  ctx.save()
  ctx.beginPath(); ctx.rect(r.x - 10, r.y - 10, (r.w + 20) * a, r.h + 20); ctx.clip()
  ctx.shadowColor = rgba(C.ink, 0.25); ctx.shadowBlur = 24; ctx.shadowOffsetY = 10
  ctx.fillStyle = C.ink; roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fill(); ctx.shadowColor = 'transparent'
  ctx.fillStyle = C.accent; ctx.fillRect(r.x, r.y, 10, r.h)
  ctx.fillStyle = C.card; ctx.font = font(620, r.h * 0.34); ctx.fillText(X.name, r.x + 36, r.y + r.h * 0.48)
  if (X.role) { ctx.fillStyle = rgba(C.card, 0.72); ctx.font = font(420, r.h * 0.22); ctx.fillText(X.role, r.x + 36, r.y + r.h * 0.8) }
  ctx.restore()
}

function drawCaptions(ctx, t, cx) {
  const { plan, L, C } = S
  if (!plan.captions || (plan.end && t >= plan.end.from)) return
  const c = plan.chunks.find((k) => t >= k.from - 0.05 && t < k.to)
  if (!c) return
  const size = L.captions.size
  ctx.font = font(600, size)
  const space = ctx.measureText(' ').width
  const widths = c.words.map((w) => ctx.measureText(w.w).width)
  const rows = [[]]; let rowW = 0
  c.words.forEach((w, i) => {
    const add = (rows[rows.length - 1].length ? space : 0) + widths[i]
    if (rows[rows.length - 1].length && rowW + add > L.captions.maxW) { rows.push([]); rowW = 0 }
    rows[rows.length - 1].push(i); rowW += (rows[rows.length - 1].length > 1 ? space : 0) + widths[i]
  })
  if (rows.length > 2) problem(`captions: "${c.words.map((w) => w.w).join(' ')}" needs ${rows.length} lines; use a smaller "captionWords"`)
  const rowWidth = (r) => r.reduce((s, i, k) => s + widths[i] + (k ? space : 0), 0)
  const box = captionBox(L, cx, Math.max(...rows.map(rowWidth)), rows.length)
  const a = fade(t, c.from - 0.05, c.to, 0.12, 0.12)
  const current = c.words.reduce((k, w, i) => (t >= w.t ? i : k), -1)
  ctx.save(); ctx.globalAlpha = a
  ctx.fillStyle = rgba(C.caption, 0.94); roundRect(ctx, box.x, box.y, box.w, box.h, 16); ctx.fill()
  rows.forEach((r, ri) => {
    let x = box.x + (box.w - rowWidth(r)) / 2
    const y = box.y + box.pad * 0.6 + box.lineH * (ri + 0.78)
    for (const i of r) {
      ctx.fillStyle = i === current ? C.captionWord : i < current ? C.captionText : rgba(C.captionText, 0.5)
      ctx.fillText(c.words[i].w, x, y); x += widths[i] + space
    }
  })
  ctx.restore()
}

function drawLabel(ctx) {
  const { plan, L, C } = S, size = L.type.label
  ctx.font = font(560, size)
  const w = ctx.measureText(plan.label).width + size * 2.6, h = size * 2, x = L.margin, y = L.margin * 0.62
  ctx.fillStyle = rgba(C.card, 0.9); roundRect(ctx, x, y, w, h, h / 2); ctx.fill()
  ctx.strokeStyle = rgba(C.ink, 0.18); ctx.lineWidth = 1.5; ctx.stroke()
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x + size * 1.05, y + h / 2, size * 0.28, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.fillText(plan.label, x + size * 1.75, y + h / 2 + 1); ctx.textBaseline = 'alphabetic'
}

/** draws the frame at t on the output canvas; returns the pose used */
export function renderAt(t) {
  const { plan, L, ctx } = S
  const aside = asideAt(plan.aside, t, plan.total)
  const box = headBox(L, aside)
  const pose = poseAt(plan.motion, t, mouthAt(plan.mouth, t, plan.fps), aside)
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1
  background(ctx, box)
  drawHead(ctx, box, pose, t)
  drawTitle(ctx, t); drawPanel(ctx, t); drawEnd(ctx, t)
  drawLowerThird(ctx, t, aside); drawCaptions(ctx, t, box.cx); drawLabel(ctx)
  return pose
}

window.renderAt = renderAt
window.issues = () => [...S.problems]
window.grab = (t, type = 'png', quality = 0.92) => {
  const pose = renderAt(t)
  return { data: S.out.toDataURL(`image/${type}`, quality).split(',')[1], mouth: pose.mouth }
}

/** the review sheet: one small frame per beat, with its time and label */
window.sheet = (beats) => {
  const { plan } = S, wide = plan.W >= plan.H, cols = Math.min(wide ? 3 : 4, beats.length), tileW = wide ? 560 : 300
  const tileH = Math.round(tileW * plan.H / plan.W), label = 34, gap = 10, rows = Math.ceil(beats.length / cols)
  const c = document.createElement('canvas'); c.width = cols * tileW + (cols + 1) * gap; c.height = rows * (tileH + label) + (rows + 1) * gap
  const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height)
  beats.forEach((b, i) => {
    renderAt(b.t)
    const x = gap + (i % cols) * (tileW + gap), y = gap + Math.floor(i / cols) * (tileH + label + gap)
    g.drawImage(S.out, x, y, tileW, tileH)
    g.fillStyle = '#eee'; g.font = '500 18px "Body", sans-serif'; g.fillText(`${b.t.toFixed(2)}s  ${b.label}`, x + 6, y + tileH + 24)
  })
  return c.toDataURL('image/png').split(',')[1]
}
