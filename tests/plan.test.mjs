import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePlan, matchWord, captionGroups, captionChunks, pointTimes, asideSpans, asideAt, nodTimes, lineWords, MOVE } from '../engine/lib/plan.mjs'
import { toVtt, toSrt, stamp } from '../engine/lib/captions.mjs'

const words = (list, start, step = 0.3) => list.map((w, i) => ({ w, t: +(start + i * step).toFixed(3) }))
const script = {
  format: 'landscape', seed: 3, character: { name: 'Juno', role: 'Example' },
  title: { text: 'Meet Juno', hold: 2 }, panel: 'How',
  lines: [{ say: 'Hello there, I am a drawing.' }, { say: 'One portrait and a *script* go in.', points: [{ text: 'A portrait', at: 'portrait' }] }],
  end: { text: 'Bye' },
}
const timeline = {
  fps: 30, total: 10, titleEnd: 2, endStart: 7, voiceEnd: 6.6,
  lines: [{ start: 2, end: 3.8, words: words(['Hello', 'there,', 'I', 'am', 'a', 'drawing.'], 2) },
    { start: 4.2, end: 6.6, words: words(['One', 'portrait', 'and', 'a', 'script', 'go', 'in.'], 4.2).map((w) => (w.w === 'script' ? { ...w, em: true } : w)) }],
  loudness: Array.from({ length: 300 }, (_, i) => ((i > 60 && i < 114) || (i > 126 && i < 198) ? 0.05 : 0)),
}

test('matchWord finds the first word starting with the given one, ignoring case and punctuation', () => {
  assert.equal(matchWord(['Hello', 'there,', 'Portraits!'], 'portrait'), 2)
  assert.equal(matchWord(['a', 'b'], 'zebra'), -1)
  assert.equal(matchWord(['a'], ''), -1)
  assert.deepEqual(lineWords('Mark *this* word'), ['Mark', 'this', 'word'])
})

test('points appear on their word', () => {
  const p = pointTimes(script, timeline)
  assert.deepEqual(p, [{ text: 'A portrait', t: 4.5, line: 1 }])
})

test('caption groups split at punctuation and never leave one word alone', () => {
  const g = captionGroups(['Hello', 'there,', 'I', 'am', 'a', 'drawing.'], 5).map((x) => x.join(' '))
  assert.deepEqual(g, ['Hello there,', 'I am a drawing.'])
  assert.ok(captionGroups('a b c d e f g h i j k'.split(' '), 4).every((x) => x.length > 1))
})

test('caption cues follow the words and end before the next one starts', () => {
  const c = captionChunks(timeline)
  assert.equal(c[0].from, 2)
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].to <= c[i].from)
  assert.ok(c.at(-1).to <= 6.6 + 0.35 + 1e-9)
  assert.match(toVtt(c), /^WEBVTT\n\n1\n00:00:02.000 --> /)
  assert.match(toSrt(c), /00:00:02,000/)
  assert.equal(stamp(3725.5), '01:02:05.500')
})

test('aside spans close enough together are joined', () => {
  assert.deepEqual(asideSpans([{ from: 0, to: 2 }, { from: 3, to: 5 }]), [{ from: 0, to: 5 }])
  assert.deepEqual(asideSpans([{ from: 0, to: 2 }, { from: 6, to: 8 }]), [{ from: 0, to: 2 }, { from: 6, to: 8 }])
})

test('the head starts moving aside just before a span and is back in the middle after it', () => {
  const spans = [{ from: 5, to: 8 }]
  assert.equal(asideAt(spans, 4), 0)
  assert.ok(asideAt(spans, 5) > 0)
  assert.equal(asideAt(spans, 6), 1)
  assert.equal(asideAt(spans, 8 + MOVE.length + 0.01), 0)
  assert.equal(asideAt([{ from: 0, to: 3 }], 0), 1, 'a span from the very start is already aside')
  assert.equal(asideAt([{ from: 5, to: 10 }], 10, 10), 1, 'a span to the very end stays aside')
})

test('nods land on marked words, else on the loudest long word, spaced apart', () => {
  const n = nodTimes(timeline, timeline.loudness, 30)
  assert.ok(n.includes(5.4), 'the *script* word')
  for (let i = 1; i < n.length; i++) assert.ok(n[i] - n[i - 1] >= 1.2)
})

test('the plan is the same every time and carries what the page needs', () => {
  const a = makePlan(script, timeline, { surface: { maxTurn: 0.5 } }), b = makePlan(script, timeline, { surface: { maxTurn: 0.5 } })
  assert.deepEqual(a, b)
  assert.equal(a.mouth.length, 300)
  assert.equal(a.motion.turn, 0.5)
  assert.equal(a.panel.from, 4.5); assert.equal(a.panel.to, 7)
  assert.deepEqual(a.aside, [{ from: 0, to: 2 }, { from: 4.5, to: 10 }], 'panel and end card are joined; the title is too far from them')
  assert.equal(a.label, 'Computer-generated character')
  assert.equal(a.lowerThird.name, 'Juno')
  assert.deepEqual(a.beats.map((x) => x.label).filter((l) => !l.startsWith('blink')).sort(), ['end card', 'line 1, mouth open', 'line 2, mouth open', 'name strap', 'point 1', 'title'])
  for (let i = 1; i < a.beats.length; i++) assert.ok(a.beats[i].t >= a.beats[i - 1].t, 'beats in time order')
  assert.equal(makePlan(script, timeline, { format: 'vertical' }).motion.glances[0].dir[1], -1, 'in vertical the panel is above, so the glance is up')
  assert.equal(makePlan({ ...script, captions: false }, timeline).captions, false)
})
