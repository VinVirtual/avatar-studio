// Seeded randomness, so every frame repeats exactly. Pure; runs in Node and in the render page.

/** A small, fast generator (mulberry32). Returns a function giving numbers in [0, 1). */
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A whole-number seed from any text (FNV-1a). */
export function seedOf(text) {
  let h = 0x811c9dc5
  for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}
