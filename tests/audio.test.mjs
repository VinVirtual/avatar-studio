import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audioInputs, timelineCheck, sameJson } from '../engine/lib/plan.mjs'
import { loadTimeline, headDir } from '../engine/lib/project.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const example = JSON.parse(readFileSync(join(ROOT, 'examples', 'juno', 'script.json'), 'utf8'))
const made = (script, extra = {}) => ({ titleEnd: script.title ? 2.6 : 0, endStart: script.end ? 20 : null, timing: 'model', inputs: audioInputs(script), ...extra })

test('Python and JavaScript agree on what shapes the voice', { skip: spawnSync('python3', ['--version']).status !== 0 && 'no python3' }, () => {
  const scripts = [example, { lines: [{ say: 'Hi.' }] }, { ...example, speed: 1.2, pronounce: { a: 'b' }, title: 'not an object', lines: [...example.lines, 'odd'] }]
  for (const s of scripts) {
    const r = spawnSync('python3', [join(ROOT, 'engine', 'audio_inputs.py')], { input: JSON.stringify(s), encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(sameJson(JSON.parse(r.stdout), audioInputs(s)), JSON.stringify(s).slice(0, 80))
  }
})

test('a timeline made from the same script is current', () => {
  assert.deepEqual(timelineCheck(example, made(example)), { stale: [], warnings: [] })
  const pointsOnly = { ...example, lines: example.lines.map((l) => ({ ...l, points: [] })), colors: { accent: '#000000' }, panel: 'Other' }
  assert.deepEqual(timelineCheck(pointsOnly, made(example)).stale, [], 'points, colours and panel do not change the voice')
})

test('every setting that changes the voice or timing makes the timeline stale', () => {
  const tl = made(example)
  const changes = {
    voice: { voice: 'am_michael' }, speed: { speed: 1.1 }, lang: { lang: 'en-gb' }, pronounce: { pronounce: { Juno: 'Joo-no' } },
    fps: { fps: 25 }, lead: { lead: 1 }, gap: { gap: 0.8 }, tail: { tail: 1 },
    title: { title: { ...example.title, hold: 4 } }, end: { end: { ...example.end, hold: 5 } },
  }
  for (const [field, change] of Object.entries(changes)) assert.deepEqual(timelineCheck({ ...example, ...change }, tl).stale, [field], field)
  const pause = { ...example, lines: example.lines.map((l, i) => (i === 1 ? { ...l, pause: 1 } : l)) }
  assert.deepEqual(timelineCheck(pause, tl).stale, ['lines'])
  assert.deepEqual(timelineCheck({ ...example, lines: [{ say: 'Different words.' }] }, tl).stale, ['lines'])
  assert.ok(timelineCheck(example, { ...tl, inputs: undefined }).stale.length, 'a timeline from an older version is stale')
})

test('a title or end card added after the voice was made is stale and named in a warning', () => {
  const bare = { ...example, title: undefined, end: undefined }
  const tl = made(bare)
  const r = timelineCheck(example, tl)
  assert.deepEqual(r.stale, ['title', 'end'])
  assert.ok(r.warnings.some((w) => /title/.test(w)) && r.warnings.some((w) => /end card/.test(w)))
})

test('estimated word times give a warning', () => {
  assert.match(timelineCheck(example, made(example, { timing: 'estimate' })).warnings.join(), /estimated/)
  assert.match(timelineCheck(example, made(example, { timing: 'mixed' })).warnings.join(), /partly estimated/)
})

test('loadTimeline refuses a stale voice and passes warnings on', () => {
  const P = mkdtempSync(join(tmpdir(), 'avatar-tl-'))
  try {
    mkdirSync(join(P, 'build'))
    writeFileSync(join(P, 'build', 'timeline.json'), JSON.stringify(made(example, { timing: 'estimate' })))
    const said = []
    assert.ok(loadTimeline(P, example, (m) => said.push(m)))
    assert.match(said.join(), /estimated/)
    assert.throws(() => loadTimeline(P, { ...example, speed: 1.3 }), /out of date: speed changed.*avatar audio/)
    rmSync(join(P, 'build', 'timeline.json'))
    assert.throws(() => loadTimeline(P, example), /no voice yet/)
  } finally { rmSync(P, { recursive: true, force: true }) }
})

test('the head folder must be inside the project, links included', () => {
  const base = mkdtempSync(join(tmpdir(), 'avatar-head-')), P = join(base, 'p'), outside = join(base, 'elsewhere')
  try {
    mkdirSync(join(P, 'head'), { recursive: true }); mkdirSync(outside)
    symlinkSync(outside, join(P, 'linked'))
    assert.equal(headDir({}, P), 'head')
    assert.equal(headDir({ head: 'head' }, P), 'head')
    for (const bad of ['../elsewhere', '/etc', 'a/../../x', '.hidden', '']) assert.throws(() => headDir({ head: bad }, P), /inside the project/, bad)
    assert.throws(() => headDir({ head: 'linked' }, P), /outside the project/)
  } finally { rmSync(base, { recursive: true, force: true }) }
})
