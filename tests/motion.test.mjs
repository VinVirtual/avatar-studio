import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blinkSchedule, blinkAt, bump, swayAt, poseAt, activity, BLINK } from '../engine/lib/motion.mjs'
import { seeded, seedOf } from '../engine/lib/rng.mjs'

test('the same seed gives the same blinks; another seed gives others', () => {
  assert.deepEqual(blinkSchedule(7, 30), blinkSchedule(7, 30))
  assert.notDeepEqual(blinkSchedule(7, 30), blinkSchedule(8, 30))
})

test('blinks are spaced like a person blinks and stay inside the video', () => {
  const b = blinkSchedule(3, 60)
  assert.ok(b.length >= 60 / BLINK.max - 1 && b.length <= 60 / BLINK.min * 1.4)
  for (const x of b) assert.ok(x.at >= 0 && x.at + x.length <= 60)
  for (let i = 1; i < b.length; i++) assert.ok(b[i].at - b[i - 1].at >= BLINK.doubleGap - 1e-9)
})

test('eyes are shut in the middle of a blink and open between blinks', () => {
  const b = [{ at: 1, length: 0.2 }]
  assert.equal(blinkAt(b, 0.5), 0)
  assert.ok(blinkAt(b, 1.08) > 0.95)
  assert.equal(blinkAt(b, 1.3), 0)
})

test('a frame does not depend on the frames before it', () => {
  const motion = { seed: 5, fps: 30, turn: 0.6, blinks: blinkSchedule(5, 10), nods: [2], glances: [{ t: 4, dir: [1, 0] }], activity: new Array(300).fill(1), asideTurn: 0.08 }
  const first = poseAt(motion, 4.2, 0.3, 1)
  for (let t = 0; t < 10; t += 0.37) poseAt(motion, t, 0.5, 0)
  assert.deepEqual(poseAt(motion, 4.2, 0.3, 1), first)
})

test('a glance turns the head towards the panel, a nod tips it down, within the turn limit', () => {
  const base = { seed: 1, fps: 30, turn: 0.6, blinks: [], nods: [], glances: [], activity: [], asideTurn: 0 }
  const still = poseAt(base, 5, 0)
  assert.ok(poseAt({ ...base, glances: [{ t: 5, dir: [1, 0] }] }, 5.4, 0).yaw > still.yaw + 0.15)
  assert.ok(poseAt({ ...base, nods: [5] }, 5.1, 0).pitch > poseAt(base, 5.1, 0).pitch + 0.03)
  assert.ok(Math.abs(poseAt({ ...base, glances: [{ t: 5, dir: [1, 0] }, { t: 5, dir: [1, 0] }, { t: 5, dir: [1, 0] }] }, 5.4, 0).yaw) <= 0.6 * 0.85 + 1e-9)
})

test('bump rises, holds and falls', () => {
  assert.equal(bump(0, 1, 0.5, 1, 0.5), 0)
  assert.equal(bump(2, 1, 0.5, 1, 0.5), 1)
  assert.equal(bump(3, 1, 0.5, 1, 0.5), 0)
})

test('sway is small and repeatable', () => {
  assert.deepEqual(swayAt(9, 3.3), swayAt(9, 3.3))
  for (let t = 0; t < 30; t += 0.5) assert.ok(Math.abs(swayAt(9, t).yaw) < 0.08)
})

test('activity is 1 while talking and 0 in long silence', () => {
  const a = activity([...new Array(60).fill(0.5), ...new Array(60).fill(0)], 30)
  assert.equal(a[20], 1); assert.equal(a[110], 0)
})

test('seeded numbers repeat, and text seeds are stable', () => {
  const a = seeded(42), b = seeded(42)
  assert.equal(a(), b())
  assert.equal(seedOf('juno'), seedOf('juno'))
  assert.notEqual(seedOf('juno'), seedOf('june'))
})
