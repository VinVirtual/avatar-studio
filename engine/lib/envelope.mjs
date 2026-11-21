// The mouth, from the voice's loudness. gen_audio.py measures the RMS level of the voice at every video frame;
// this turns those numbers into how far the mouth is open (0 shut, 1 fully open) at every frame.
// It is loudness, not lip-sync: the mouth opens on loud sounds and closes in pauses, whatever the sound is.
// Pure; runs in Node and in the render page.

export const MOUTH_DEFAULTS = {
  range: 30,      // dB below the reference level at which the mouth is shut
  reference: 0.9, // share of voiced frames that are quieter than the reference level (a high percentile, not the peak)
  curve: 1.25,    // >1 keeps quiet sounds small and leaves room for loud ones
  most: 0.92,     // the widest the mouth opens
  attack: 0.7,    // how much of the way to a louder target the mouth moves in one frame
  release: 0.45,  // the same for closing; slower than opening, as mouths are
  lead: 1,        // frames the mouth runs ahead of the sound (lips move just before the sound is heard)
  silence: 0.004, // RMS below this counts as silence
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** the value below which `share` of the numbers lie */
export function percentile(values, share) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[clamp(Math.round(share * (sorted.length - 1)), 0, sorted.length - 1)]
}

/** One opening per frame from one RMS level per frame. */
export function mouthTrack(loudness, options = {}) {
  const o = { ...MOUTH_DEFAULTS, ...options }
  const voiced = loudness.filter((v) => v > o.silence)
  const ref = percentile(voiced, o.reference) || 1
  const target = loudness.map((v) => {
    if (!(v > o.silence)) return 0
    const db = 20 * Math.log10(v / ref)
    return o.most * Math.pow(clamp((db + o.range) / o.range, 0, 1), o.curve)
  })
  const shifted = target.map((_, i) => target[Math.min(target.length - 1, i + o.lead)])
  const out = new Array(shifted.length)
  let open = 0
  for (let i = 0; i < shifted.length; i++) {
    const goal = shifted[i]
    open += (goal - open) * (goal > open ? o.attack : o.release)
    out[i] = Math.round(open * 1e4) / 1e4
  }
  return out
}

/** the opening at time t, read off the per-frame track (between frames it blends the two nearest) */
export function mouthAt(track, t, fps) {
  if (!track.length) return 0
  const f = t * fps, i = Math.floor(f)
  if (i < 0) return track[0]
  if (i >= track.length - 1) return track[track.length - 1]
  return track[i] + (track[i + 1] - track[i]) * (f - i)
}

/** Pearson correlation of two equal-length lists (used to check that the mouth follows the sound) */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0
}

/** the shift of b against a (in frames, within ±reach) that lines them up best, and the correlation there */
export function bestLag(a, b, reach = 6) {
  let best = { lag: 0, r: -Infinity }
  for (let lag = -reach; lag <= reach; lag++) {
    const x = [], y = []
    for (let i = 0; i < a.length; i++) { const j = i + lag; if (j >= 0 && j < b.length) { x.push(a[i]); y.push(b[j]) } }
    const r = correlation(x, y)
    if (r > best.r) best = { lag, r }
  }
  return best
}
