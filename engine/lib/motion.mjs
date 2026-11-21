// Blinks, sway, nods and glances: everything about the head except the mouth, as plain functions of time.
// Random choices come from a seed, so the same script gives the same performance every time and any frame
// can be drawn on its own, in any order. Pure; runs in Node and in the render page.
import { seeded } from './rng.mjs'

export const BLINK = { min: 2.4, max: 5.4, length: 0.17, double: 0.15, doubleGap: 0.28 }
export const NOD = { depth: 0.055, rise: 0.11, fall: 0.38 }
export const GLANCE = { share: 0.42, rise: 0.28, hold: 0.7, fall: 0.5, lift: 0.04 }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const smooth = (x) => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c) }

/** When the eyes blink: [{ at, length }] over `total` seconds, from the seed. Sometimes twice in a row. */
export function blinkSchedule(seed, total, options = {}) {
  const o = { ...BLINK, ...options }, random = seeded(seed), out = []
  let t = 0.6 + random() * (o.max - o.min) * 0.5
  while (t < total - o.length) {
    out.push({ at: +t.toFixed(3), length: o.length })
    if (random() < o.double && t + o.doubleGap + o.length < total) out.push({ at: +(t + o.doubleGap).toFixed(3), length: o.length })
    t += o.min + random() * (o.max - o.min)
  }
  return out
}

/** how shut the eyes are at t: 0 open, 1 shut. Closing is quicker than opening. */
export function blinkAt(blinks, t) {
  for (const b of blinks) {
    if (t < b.at) break
    const x = (t - b.at) / b.length
    if (x <= 1) return x < 0.4 ? smooth(x / 0.4) : 1 - smooth((x - 0.4) / 0.6)
  }
  return 0
}

/** a smooth bump: 0 before `at`, up to 1 over `rise`, held for `hold`, back to 0 over `fall` */
export function bump(t, at, rise, hold, fall) {
  const x = t - at
  if (x <= 0) return 0
  if (x < rise) return smooth(x / rise)
  if (x < rise + hold) return 1
  return 1 - smooth((x - rise - hold) / fall)
}

/** a slow, never-repeating drift of the head, from the seed: { yaw, pitch, lift } in radians and plane units */
export function swayAt(seed, t, amount = 1) {
  const r = seeded(seed), p = Array.from({ length: 6 }, () => r() * Math.PI * 2)
  const yaw = 0.045 * Math.sin(t * 0.47 + p[0]) + 0.02 * Math.sin(t * 1.13 + p[1])
  const pitch = 0.018 * Math.sin(t * 0.61 + p[2]) + 0.01 * Math.sin(t * 1.71 + p[3])
  const lift = 0.006 * Math.sin(t * 1.4 + p[4]) // breathing
  return { yaw: yaw * amount, pitch: pitch * amount, lift: lift + 0.002 * Math.sin(t * 2.3 + p[5]) * amount }
}

/**
 * The whole pose at t, for the viewer's renderPose: { yaw, pitch, eyes, mouth, lift }.
 * `motion` comes from plan.mjs: { seed, blinks, nods: [t], glances: [{ t, dir }], turn, mouth, fps, activity, asideTurn }
 * `aside` (0 to 1) is how far the head has moved to the side; it then turns a little towards the middle.
 */
export function poseAt(motion, t, mouth, aside = 0) {
  const fps = motion.fps
  const i = clamp(Math.round(t * fps), 0, Math.max(0, motion.activity.length - 1))
  const talking = motion.activity.length ? motion.activity[i] : 0
  const sway = swayAt(motion.seed, t, 0.7 + 0.5 * talking)
  let pitch = sway.pitch, yaw = sway.yaw
  for (const at of motion.nods) pitch += NOD.depth * bump(t, at - 0.04, NOD.rise, 0, NOD.fall)
  for (const g of motion.glances) {
    const b = bump(t, g.t - GLANCE.rise * 0.5, GLANCE.rise, GLANCE.hold, GLANCE.fall)
    yaw += g.dir[0] * GLANCE.share * motion.turn * b
    pitch += g.dir[1] * GLANCE.lift * b
  }
  yaw += (motion.asideTurn || 0) * aside
  const limit = motion.turn * 0.85
  return { yaw: clamp(yaw, -limit, limit), pitch: clamp(pitch, -0.12, 0.12), eyes: blinkAt(motion.blinks, t), mouth, lift: sway.lift }
}

/** how much the voice is going at each frame, smoothed over about a second (0 to 1); talking heads move more */
export function activity(track, fps) {
  const reach = Math.max(1, Math.round(fps * 0.5)), out = new Array(track.length)
  const sums = [0]
  for (const v of track) sums.push(sums[sums.length - 1] + (v > 0.05 ? 1 : 0))
  for (let i = 0; i < track.length; i++) {
    const a = Math.max(0, i - reach), b = Math.min(track.length, i + reach + 1)
    out[i] = +((sums[b] - sums[a]) / (b - a)).toFixed(3)
  }
  return out
}
