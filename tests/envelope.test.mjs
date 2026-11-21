import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mouthTrack, mouthAt, percentile, correlation, bestLag } from '../engine/lib/envelope.mjs'

const speech = (n) => Array.from({ length: n }, (_, i) => (i % 20 < 12 ? 0.05 + 0.04 * Math.sin(i * 1.3) ** 2 : 0.0005))

test('silence keeps the mouth shut', () => {
  assert.deepEqual(mouthTrack([0, 0, 0.001, 0]), [0, 0, 0, 0])
})

test('the mouth opens with loudness and stays within 0 and the widest opening', () => {
  const track = mouthTrack(speech(200))
  assert.ok(Math.max(...track) > 0.5)
  assert.ok(track.every((v) => v >= 0 && v <= 0.92))
})

test('louder frames give a wider mouth (before smoothing)', () => {
  const t = mouthTrack([0.01, 0.02, 0.04, 0.08, 0.08, 0.08], { attack: 1, release: 1, lead: 0 })
  for (let i = 1; i < 4; i++) assert.ok(t[i] >= t[i - 1])
})

test('the mouth closes more slowly than it opens', () => {
  const up = mouthTrack([0, 0.1, 0.1], { lead: 0 })[1], down = mouthTrack([0.1, 0.1, 0.1, 0.1, 0], { lead: 0 })
  assert.ok(up > down[3] - down[4], 'one frame of opening covers more than one frame of closing')
})

test('the mouth leads the sound by the given number of frames', () => {
  const loud = [0, 0, 0, 0.1, 0.1, 0.1]
  assert.equal(mouthTrack(loud, { lead: 1 })[2] > 0, true)
  assert.equal(mouthTrack(loud, { lead: 0 })[2], 0)
})

test('the track correlates with the loudness it came from', () => {
  const loud = speech(300)
  assert.ok(correlation(loud, mouthTrack(loud, { lead: 0 })) > 0.8)
  assert.equal(bestLag(loud, mouthTrack(loud, { lead: 2, attack: 1, release: 1 })).lag, -2)
})

test('mouthAt blends neighbouring frames and holds the ends', () => {
  assert.equal(mouthAt([0, 1], 0.5 / 30, 30), 0.5)
  assert.equal(mouthAt([0.2, 0.4], -1, 30), 0.2)
  assert.equal(mouthAt([0.2, 0.4], 99, 30), 0.4)
  assert.equal(mouthAt([], 1, 30), 0)
})

test('percentile', () => {
  assert.equal(percentile([5, 1, 3], 0.5), 3)
  assert.equal(percentile([], 0.9), 0)
})
