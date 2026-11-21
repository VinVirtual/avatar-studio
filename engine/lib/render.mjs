// Rendering: stills, the review sheet, the video, the web copy and the looping preview.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findFF } from './env.mjs'
import { openStage, grab } from './stage.mjs'
import { toVtt, toSrt } from './captions.mjs'
import { correlation, bestLag } from './envelope.mjs'

/** run ffmpeg to the end; `input` (a Buffer) goes to its stdin. Resolves to stdout when `capture` is set. */
export function ffmpeg(args, { input, capture = false } = {}) {
  const FF = findFF()
  return new Promise((done, fail) => {
    const c = spawn(FF, ['-y', '-loglevel', 'error', ...args], { stdio: [input ? 'pipe' : 'ignore', capture ? 'pipe' : 'inherit', 'inherit'] })
    const chunks = []
    if (capture) c.stdout.on('data', (d) => chunks.push(d))
    c.on('error', (e) => fail(new Error(`could not start ffmpeg (${FF}): ${e.message}`)))
    c.on('close', (code) => (code ? fail(new Error('ffmpeg exited with code ' + code)) : done(Buffer.concat(chunks))))
    if (input) { c.stdin.on('error', () => {}); c.stdin.end(input) }
  })
}

// BT.709 in limited range, tagged, so browsers and phones show the colours as drawn (from reel-studio)
const COLOUR = 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+bicubic,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv'

/** speech loudness for web and phone playback (EBU R128 measure, -16 LUFS, peaks at most -1.5 dBTP) */
export const LOUDNESS = 'loudnorm=I=-16:TP=-1.5:LRA=11'

export async function renderStills({ P, plan, head, outName, times, log }) {
  const dir = join(P, 'stills'); mkdirSync(dir, { recursive: true })
  const stage = await openStage({ P, plan, head, log })
  try {
    const out = []
    for (const t of times) { const f = join(dir, `${outName}-t${t.toFixed(2)}.png`); writeFileSync(f, (await grab(stage.pages[0], t)).image); out.push(f) }
    return { files: out, issues: await stage.issues() }
  } finally { await stage.close() }
}

/** one frame per beat, drawn small with its label, tiled into one PNG by the page */
export async function renderSheet({ P, plan, head, outName, log }) {
  const dir = join(P, 'stills'); mkdirSync(dir, { recursive: true })
  const stage = await openStage({ P, plan, head, log })
  try {
    const data = await stage.pages[0].evaluate((beats) => window.sheet(beats), plan.beats)
    const out = join(dir, `${outName}-sheet.png`)
    writeFileSync(out, Buffer.from(data, 'base64'))
    return { out, issues: await stage.issues() }
  } finally { await stage.close() }
}

export function writeCaptions(P, outName, plan) {
  const dir = join(P, 'out'); mkdirSync(dir, { recursive: true })
  const vtt = join(dir, `${outName}.vtt`), srt = join(dir, `${outName}.srt`)
  writeFileSync(vtt, toVtt(plan.chunks)); writeFileSync(srt, toSrt(plan.chunks))
  return { vtt, srt }
}

/** Every frame, drawn in `workers` pages at once (a frame depends only on t), written to ffmpeg in order. */
export async function renderVideo({ P, plan, head, outName, workers = 2, log }) {
  const voice = join(P, 'build', 'voice.wav')
  if (!existsSync(voice)) throw new Error(`no voice yet (${voice}). Run: avatar audio ${P}`)
  const dir = join(P, 'out'); mkdirSync(dir, { recursive: true })
  const out = join(dir, `${outName}.mp4`), n = Math.round(plan.total * plan.fps)
  const stage = await openStage({ P, plan, head, pages: workers, log })
  const t0 = Date.now(), mouths = new Array(n)
  try {
    const FF = findFF()
    const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'mjpeg', '-i', '-', '-i', voice,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-vf', COLOUR, '-profile:v', 'high', '-af', LOUDNESS, '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
    let dead = null
    const closed = new Promise((r) => ff.on('close', (code) => { if (code) dead = new Error('ffmpeg exited with code ' + code); r() }))
    ff.on('error', (e) => { dead = new Error(`could not start ffmpeg (${FF}): ${e.message}`) })
    ff.stdin.on('error', (e) => { dead = dead || new Error('ffmpeg stopped reading frames: ' + e.message) })
    const ready = new Map(); let next = 0, writing = Promise.resolve()
    const flush = async () => {
      while (ready.has(next) && !dead) {
        const buf = ready.get(next); ready.delete(next); next++
        if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), closed])
        if (next % 150 === 0) log(`frame ${next}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      }
    }
    const K = stage.pages.length
    await Promise.all(stage.pages.map(async (page, k) => {
      for (let i = k; i < n; i += K) {
        while (i - next > 24 && !dead) await new Promise((r) => setTimeout(r, 5))
        if (dead) return
        const f = await grab(page, i / plan.fps, 'jpeg', 0.94)
        mouths[i] = f.mouth; ready.set(i, f.image); writing = writing.then(flush)
      }
    }))
    await writing
    ff.stdin.end(); await closed
    if (dead) throw dead
    const issues = await stage.issues()
    return { out, frames: n, workers: K, seconds: (Date.now() - t0) / 1000, mouths, issues, ...writeCaptions(P, outName, plan) }
  } finally { await stage.close() }
}

/** Read the sound back out of the finished MP4 and compare it with the mouth that was drawn, frame by frame. */
export async function syncReport(mp4, mouths, fps) {
  const rate = 16000
  const pcm = await ffmpeg(['-i', mp4, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { capture: true })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2)), per = rate / fps, energy = []
  for (let i = 0; i < mouths.length; i++) {
    const a = Math.max(0, Math.round((i - 0.75) * per)), b = Math.min(samples.length, Math.round((i + 0.75) * per))
    let s = 0; for (let j = a; j < b; j++) s += (samples[j] / 32768) ** 2
    energy.push(b > a ? Math.sqrt(s / (b - a)) : 0)
  }
  const seconds = samples.length / rate, lag = bestLag(energy, mouths, 6)
  return { seconds, r: correlation(energy, mouths), lag: lag.lag, lagR: lag.r, openWhenQuiet: share(mouths, energy, (m, e) => e < 0.003 && m > 0.15), shutWhenLoud: share(mouths, energy, (m, e) => e > 0.05 && m < 0.05) }
}
const share = (m, e, test) => { let n = 0; for (let i = 0; i < m.length; i++) if (test(m[i], e[i])) n++; return n / Math.max(1, m.length) }

/** a small faststart MP4 (short side `size`), a poster JPEG drawn without captions, and the captions */
export async function exportWeb({ P, plan, head, outName, size = 720, crf = 28, posterAt, log }) {
  const src = join(P, 'out', `${outName}.mp4`)
  if (!existsSync(src)) throw new Error(`no video yet (${src}). Run: avatar video ${P}`)
  const dir = join(P, 'out', 'web'); mkdirSync(dir, { recursive: true })
  const wide = plan.W >= plan.H, scale = wide ? `scale=-2:${size}:flags=lanczos` : `scale=${size}:-2:flags=lanczos`
  const mp4 = join(dir, `${outName}.mp4`), jpg = join(dir, `${outName}.jpg`), vtt = join(dir, `${outName}.vtt`)
  await ffmpeg(['-i', src, '-vf', scale + ',setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', mp4])
  const stage = await openStage({ P, plan: { ...plan, captions: false }, head, log })
  try {
    const at = Number.isFinite(posterAt) ? posterAt : posterTime(plan)
    await ffmpeg(['-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', scale, '-frames:v', '1', '-q:v', '3', '-update', '1', jpg], { input: (await grab(stage.pages[0], at)).image })
  } finally { await stage.close() }
  writeFileSync(vtt, readFileSync(join(P, 'out', `${outName}.vtt`)))
  return { mp4, jpg, vtt }
}

/** the poster frame: the script's "poster" seconds, else a moment with the side panel full and the mouth a little open */
export function posterTime(plan) {
  if (Number.isFinite(plan.poster)) return plan.poster
  const from = plan.panel ? plan.panel.points[plan.panel.points.length - 1].t + 0.8 : plan.lines[0].start + 0.5
  const to = plan.end ? plan.end.from - 0.2 : plan.total - 0.2
  let best = Math.round(from * plan.fps)
  for (let f = best; f <= Math.round(to * plan.fps) && f < plan.mouth.length; f++) {
    const m = plan.mouth[f]
    if (Math.abs(m - 0.35) < Math.abs(plan.mouth[best] - 0.35)) best = f
  }
  return best / plan.fps
}

/** a short looping animated WebP (and GIF fallback) cut from the web MP4, for the top of a README */
export async function loopPreview({ P, outName, from = 3, seconds = 5, width = 480, fps = 12 }) {
  const src = join(P, 'out', 'web', `${outName}.mp4`)
  if (!existsSync(src)) throw new Error(`no web video yet (${src}). Run: avatar video ${P} --web`)
  const webp = join(P, 'out', 'web', `${outName}-preview.webp`), gif = join(P, 'out', 'web', `${outName}-preview.gif`)
  const vf = `fps=${fps},scale=${width}:-2:flags=lanczos`
  await ffmpeg(['-ss', String(from), '-t', String(seconds), '-i', src, '-vf', vf, '-an', '-c:v', 'libwebp_anim', '-loop', '0', '-quality', '70', '-compression_level', '6', webp])
  await ffmpeg(['-ss', String(from), '-t', String(seconds), '-i', src, '-vf', `${vf},split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-an', '-loop', '0', gif])
  return { webp, gif }
}
