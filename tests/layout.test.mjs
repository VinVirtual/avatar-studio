import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORMATS, layoutFor, headBox, captionBox, panelRows, overlaps, wrapWords } from '../engine/lib/layout.mjs'

for (const name of Object.keys(FORMATS)) {
  const L = layoutFor(name)
  test(`${name}: the short side is 1080 and the panel stays inside the frame`, () => {
    assert.equal(Math.min(L.W, L.H), 1080)
    const s = L.slot
    assert.ok(s.x >= L.margin * 0.5 && s.y >= 0 && s.x + s.w <= L.W - L.margin * 0.5 && s.y + s.h <= L.H)
  })
  test(`${name}: the head moves smoothly from the middle to the side`, () => {
    assert.deepEqual(headBox(L, 0), { x: L.head.solo.cx - L.head.solo.size / 2, y: L.head.solo.bottom - L.head.solo.size, size: L.head.solo.size, cx: L.head.solo.cx })
    const mid = headBox(L, 0.5)
    assert.equal(mid.cx, (L.head.solo.cx + L.head.aside.cx) / 2)
  })
  test(`${name}: the face is clear of the side panel when the head is aside`, () => {
    const b = headBox(L, 1)
    const face = { x: b.x + b.size * 0.3, y: b.y + b.size * 0.25, w: b.size * 0.4, h: b.size * 0.45 } // eyes to chin in a portrait
    const s = L.slot, rows = panelRows(L)
    if (s.x > L.W / 3) assert.ok(!overlaps(face, { x: s.x, y: s.y, w: s.w, h: s.h }))
    else assert.ok(!overlaps(face, { x: s.x, y: rows.heading.y, w: s.w, h: rows.rows.at(-1).y + rows.rows.at(-1).h - rows.heading.y }))
  })
  test(`${name}: captions stay inside the margins and below the mouth`, () => {
    for (const p of [0, 1]) {
      const b = headBox(L, p), c = captionBox(L, b.cx, 5000, 2)
      assert.ok(c.x >= L.margin - 1e-9 && c.x + c.w <= L.W - L.margin + 1e-9)
      assert.ok(c.y > b.y + b.size * 0.66, 'caption box starts below the chin')
    }
  })
  test(`${name}: panel rows are equal, inside the slot, and centred`, () => {
    const { heading, rows } = panelRows(L, 3)
    assert.equal(rows.length, 3)
    assert.ok(heading.y >= L.slot.y && rows.at(-1).y + rows.at(-1).h <= L.slot.y + L.slot.h + 1e-9)
    const above = heading.y - L.slot.y, below = L.slot.y + L.slot.h - (rows.at(-1).y + rows.at(-1).h)
    assert.ok(Math.abs(above - below) < 1e-6)
    assert.equal(panelRows(L, 99).rows.length, L.capacity)
  })
}

test('unknown format is refused', () => assert.throws(() => layoutFor('portrait'), /unknown format/))

test('wrapWords breaks at the width and keeps every word', () => {
  const lines = wrapWords('one two three four five', 9, (s) => s.length)
  assert.deepEqual(lines, ['one two', 'three', 'four five'])
  assert.deepEqual(wrapWords('', 10, (s) => s.length), [])
})
