import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lintScript, contrast, formatIssues } from '../engine/lib/lint.mjs'

const good = {
  character: { name: 'Juno', likeness: 'original' },
  lines: [{ say: 'One portrait and a script.', points: [{ text: 'A portrait', at: 'portrait' }] }],
}
const rules = (s, o) => lintScript(s, o).map((i) => `${i.level}:${i.rule}`)

test('a good script has no issues', () => assert.deepEqual(lintScript(good), []))

test('a point must hang on a word of its own line', () => {
  assert.ok(rules({ ...good, lines: [{ say: 'Hello.', points: [{ text: 'x', at: 'portrait' }] }] }).includes('error:point-at'))
  assert.ok(rules({ ...good, lines: [{ say: 'Hello.', points: [{ text: 'x' }] }] }).includes('error:point-at'))
})

test('too many points for the format is an error', () => {
  const lines = [{ say: 'a b c d e', points: ['a', 'b', 'c', 'd', 'e'].map((w) => ({ text: w, at: w })) }]
  assert.ok(!rules({ ...good, lines }).includes('error:capacity'))
  assert.ok(rules({ ...good, lines, format: 'square' }).includes('error:capacity'))
  assert.ok(rules({ ...good, lines }, { format: 'vertical' }).includes('error:capacity'))
})

test('the computer-generated label cannot be removed', () => {
  assert.ok(rules({ ...good, label: '' }).includes('error:label'))
  assert.ok(rules({ ...good, label: false }).includes('error:label'))
  assert.ok(rules({ ...good, label: 'Juno' }).includes('warn:label'))
  assert.deepEqual(rules({ ...good, label: 'AI-generated host' }), [])
})

test('a real person needs recorded consent', () => {
  assert.ok(rules({ ...good, character: { name: 'X', likeness: 'real-person-with-consent' } }).includes('error:consent'))
  assert.deepEqual(rules({ ...good, character: { name: 'X', likeness: 'real-person-with-consent', consent: true } }), [])
  assert.ok(rules({ ...good, character: undefined }).includes('warn:likeness'))
})

test('colours: bad values and low contrast', () => {
  assert.ok(rules({ ...good, colors: { ink: 'navy' } }).includes('error:color'))
  assert.ok(rules({ ...good, colors: { ink: '#EEEEEE', bg: '#FFFFFF' } }).includes('error:contrast'))
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9)
})

test('missing lines, empty say, bad speed, fps and patterns are errors', () => {
  assert.ok(rules({ ...good, lines: [] }).includes('error:lines'))
  assert.ok(rules({ ...good, lines: [{ say: ' ' }] }).includes('error:say'))
  assert.ok(rules({ ...good, speed: 3 }).includes('error:speed'))
  assert.ok(rules({ ...good, fps: 29 }).includes('error:fps'))
  assert.ok(rules({ ...good, pronounce: { '(': 'x' } }).includes('error:pronounce'))
  assert.ok(rules({ ...good, format: 'portrait' }).includes('error:format'))
})

test('unknown fields, long points and odd emphasis marks are warnings', () => {
  assert.ok(rules({ ...good, colour: 1 }).includes('warn:unknown-field'))
  assert.ok(rules({ ...good, lines: [{ say: 'a portrait', points: [{ text: 'one two three four five six seven eight', at: 'portrait' }] }] }).includes('warn:point-length'))
  assert.ok(rules({ ...good, lines: [{ say: 'a *b' }] }).includes('warn:emphasis'))
})

test('head files are checked through the given exists function', () => {
  assert.ok(rules(good, { exists: () => false }).includes('error:head-files'))
  assert.equal(formatIssues([]), 'no problems found')
})
