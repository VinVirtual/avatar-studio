#!/usr/bin/env node
// avatar-studio command line. Run `avatar help` for the list of commands.
import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { ENGINE, SKILL, findPython, findFF, findPlaywright, findTalkingHead, talkingHeadHint, findThree, launchBrowser, KOKORO_HOME } from './lib/env.mjs'
import { projectDir, loadScript, loadPlan, headDir, parseArgs, readJson } from './lib/project.mjs'
import { lintScript, formatIssues } from './lib/lint.mjs'
import { timelineCheck } from './lib/plan.mjs'
import { renderStills, renderSheet, renderVideo, exportWeb, loopPreview, syncReport } from './lib/render.mjs'
import { MAX_PAGES } from './lib/stage.mjs'

const HELP = `avatar-studio: one illustrated portrait and a script in, a video of that character speaking out. All on this machine.

  avatar check                          check the machine (talking-head, three.js, Kokoro, ffmpeg, Playwright, browser)
  avatar new <dir> [--portrait FILE | --head DIR]
                                        start a project: script.json, and either the portrait to build a head from
                                        or an existing head (a folder with head.glb and head.json)
  avatar lint <dir>                     check the script   [--format f] [--json]
  avatar head <dir>                     build head/head.glb + head.json from portrait.png with talking-head (Blender), offline
                                        [--mesh FILE] [--marks FILE] [--force: redo the marks after the portrait changed]
                                        [--source space --yes: UPLOADS the portrait to a third party, the public Hunyuan3D-2
                                         demo on Hugging Face. Only with the user's explicit agreement.]
  avatar audio <dir>                    the voice (Kokoro), word timings and per-frame loudness
  avatar sheet <dir>                    stills/<name>-sheet.png: one frame per beat, to review   [--format f]
  avatar stills <dir> 1.5 4 9           single frames at those seconds   [--format f]
  avatar video <dir>                    out/<name>.mp4 + .vtt + .srt, and a mouth/sound sync report
                                        [--web] [--format vertical|square|landscape] [--no-captions] [--workers 1|2]
  avatar build <dir>                    lint, audio (if the lines changed), sheet, video, web copy and looping preview
  avatar test                           run the unit tests

<name> is the project folder's name, or <name>-<format> with --format, so two shapes do not overwrite each other.
sheet, stills, video and build run lint first and stop on errors (consent, label, missing head, points on unknown words).
`

process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e })
const say = (m) => process.stdout.write(m + '\n')
const note = (m) => process.stderr.write(m + '\n')
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status ?? 1
const PICTURES = ['.png', '.jpg', '.jpeg']

function reportIssues(issues) {
  for (const m of issues) note(`layout: ${m}`)
  return issues.length
}

function lint(P, flags) {
  const script = loadScript(P)
  return lintScript(script, { exists: (f) => existsSync(join(P, f)), format: flags.format === true ? undefined : flags.format })
}

/** lint before any render: warnings are shown, errors stop the command */
function gate(P, flags) {
  const issues = lint(P, flags)
  for (const i of issues) note(`${i.level === 'error' ? 'ERROR' : 'warn '} ${i.where}: ${i.message}`)
  if (issues.some((i) => i.level === 'error')) throw new Error(`fix the lint errors above first (avatar lint ${P})`)
}

async function audio(P) {
  const code = sh(findPython(), [join(ENGINE, 'gen_audio.py'), P])
  if (code) throw new Error('the voice step failed (see above)')
}

async function video(P, flags) {
  const { plan, head, outName } = loadPlan(P, flags, note)
  const workers = Math.min(MAX_PAGES, Math.max(1, Number(flags.workers) || MAX_PAGES))
  const r = await renderVideo({ P, plan, head, outName, workers, log: note })
  say(`${r.out}  (${plan.total}s, ${r.frames} frames, ${plan.W}x${plan.H}, ${r.seconds.toFixed(0)}s with ${r.workers} page(s))`)
  say(`${r.vtt}\n${r.srt}`)
  reportIssues(r.issues)
  const s = await syncReport(r.out, r.mouths, plan.fps)
  writeFileSync(join(P, 'build', `${outName}.sync.json`), JSON.stringify(s, null, 1))
  say(`sync: audio ${s.seconds.toFixed(2)}s for ${plan.total}s of video; mouth vs sound energy r=${s.r.toFixed(2)}, best lag ${s.lag} frame(s) (r=${s.lagR.toFixed(2)}); ` +
    `open in silence ${(s.openWhenQuiet * 100).toFixed(1)}% of frames, shut while loud ${(s.shutWhenLoud * 100).toFixed(1)}%`)
  if (s.r < 0.6 || Math.abs(s.lag) > 2) note('warning: the mouth does not follow the sound well. Check build/timeline.json and the "mouth" settings in script.json.')
  if (flags.web) {
    const w = await exportWeb({ P, plan, head, outName, log: note })
    say(`${w.mp4}\n${w.jpg}\n${w.vtt}`)
  }
  return { plan, outName }
}

const sha = (path) => createHash('sha1').update(readFileSync(path)).digest('hex')

/** copy a built head (head.glb + head.json, and portrait.png if there) into <project>/head */
function copyHead(from, to) {
  for (const f of ['head.glb', 'head.json']) if (!existsSync(join(from, f))) throw new Error(`${join(from, f)} is missing`)
  mkdirSync(to, { recursive: true })
  for (const f of ['head.glb', 'head.json', 'portrait.png', 'preview.png']) if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f))
}

const COMMANDS = {
  help: async () => say(HELP),

  async check() {
    let good = true
    const line = (ok, text, hint = '', needed = true) => { if (!ok && needed) good = false; say(`${ok ? 'ok  ' : needed ? 'MISS' : 'note'} ${text}`); if (!ok && hint) say(`       ${hint}`) }
    const th = findTalkingHead()
    line(!!th, `talking-head ${th ? `(${th})` : ''}`, talkingHeadHint())
    const three = findThree(th)
    line(!!three, `three.js ${three ? `(${three})` : ''}`, `npm install   (in ${SKILL}), or set AVATAR_THREE to a three.js folder`)
    const py = findPython()
    line(spawnSync(py, ['-c', 'import kokoro_onnx, soundfile, numpy']).status === 0, `python with kokoro-onnx (${py})`, `pip install "kokoro-onnx>=0.6" soundfile numpy imageio-ffmpeg   (or set AVATAR_PYTHON)`)
    line(spawnSync(py, ['-c', 'from kokoro_onnx import Kokoro; assert hasattr(Kokoro, "create_timed")']).status === 0, 'kokoro-onnx 0.6 or newer (measured word times)', `pip install -U "kokoro-onnx>=0.6"   (older versions work, with estimated word times)`, false)
    const model = process.env.KOKORO_MODEL || join(KOKORO_HOME, 'kokoro-v1.0.onnx'), voices = process.env.KOKORO_VOICES || join(KOKORO_HOME, 'voices-v1.0.bin')
    line(existsSync(model) && existsSync(voices), `Kokoro model files (${KOKORO_HOME})`, 'download kokoro-v1.0.onnx and voices-v1.0.bin (README, "Install"), or set KOKORO_HOME')
    let ff = null; try { ff = findFF() } catch {}
    line(!!ff, `ffmpeg ${ff ? `(${ff})` : ''}`, 'install ffmpeg, or pip install imageio-ffmpeg in the Kokoro venv, or set FF')
    let pw = null; try { pw = findPlaywright().from } catch {}
    line(!!pw, `playwright-core ${pw ? `(${pw})` : ''}`, 'npm i -g playwright-core')
    if (pw) {
      try {
        const browser = await launchBrowser()
        const page = await browser.newPage()
        const gl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
        await browser.close()
        line(gl, 'browser starts and has WebGL', 'install Google Chrome or Chromium (set AVATAR_CHROME to choose one)')
      } catch (e) { line(false, 'browser', String(e.message).split('\n')[0]) }
    }
    if (th) say(`note building a new head needs Blender: run  ${join(th, 'head')} check --offline`)
    say(good ? 'all good' : 'something needed is missing: fix the MISS lines above and run this again')
    if (!good) process.exit(1)
  },

  async new({ rest, flags }) {
    if (!rest[0]) throw new Error('usage: avatar new <dir> [--portrait FILE | --head DIR]')
    const P = resolve(rest[0])
    mkdirSync(P, { recursive: true })
    const made = []
    if (!existsSync(join(P, 'script.json'))) { copyFileSync(join(SKILL, 'templates', 'script.json'), join(P, 'script.json')); made.push('script.json') }
    if (typeof flags.portrait === 'string') {
      const ext = extname(flags.portrait).toLowerCase()
      if (!PICTURES.includes(ext) || !existsSync(flags.portrait)) throw new Error('--portrait must be an existing PNG or JPEG picture')
      copyFileSync(flags.portrait, join(P, `portrait${ext === '.jpeg' ? '.jpg' : ext}`)); made.push(`portrait${ext === '.jpeg' ? '.jpg' : ext}`)
    }
    if (typeof flags.head === 'string') { copyHead(resolve(flags.head), join(P, 'head')); made.push('head/') }
    say(`project ready: ${P}${made.length ? `  (wrote ${made.join(', ')})` : ''}`)
    say('Before going on: whose face is this? A real person needs to have agreed (see SKILL.md).')
    say(`next: ${existsSync(join(P, 'head', 'head.glb')) ? '' : `avatar head ${P}   then  `}edit script.json, then  avatar lint ${P} && avatar audio ${P} && avatar sheet ${P}`)
  },

  async lint({ rest, flags }) {
    const P = projectDir(rest[0]), issues = lint(P, flags)
    say(flags.json ? JSON.stringify(issues, null, 1) : formatIssues(issues))
    if (issues.some((i) => i.level === 'error')) process.exit(1)
  },

  async head({ rest, flags }) {
    const P = projectDir(rest[0]), th = findTalkingHead()
    if (!th) throw new Error(talkingHeadHint())
    const headFolder = headDir(loadScript(P), P)
    const picture = PICTURES.map((e) => join(P, `portrait${e}`)).find(existsSync)
    if (!picture) throw new Error(`no portrait.png or portrait.jpg in ${P}. Start with: avatar new ${P} --portrait FILE`)
    if (flags.source === 'space' && !flags.yes) throw new Error('--source space UPLOADS the portrait to a third party (the public Hunyuan3D-2 demo on Hugging Face, run by Tencent). Ask the user first; add --yes only once they agreed (it is passed on to talking-head as --yes-upload).')
    const H = join(th, 'head'), work = join(P, 'build', 'head'), stamp = join(work, 'portrait.sha1'), marks = join(work, 'marks.json')
    const step = (args) => { say(`$ head ${args.join(' ')}`); if (sh(H, args)) throw new Error(`talking-head failed at "head ${args[0]}". Fix it there (see its SKILL.md), then run avatar head again.`) }
    // marks belong to one picture: when the portrait changed since they were made, they must be made again
    const now = sha(picture), before = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null
    const marksStale = existsSync(marks) && before !== now
    if (marksStale && typeof flags.marks !== 'string' && !flags.force)
      throw new Error(`the portrait changed since its marks were made (${marks}). Run again with --force to estimate new marks, or give --marks FILE.`)
    step(['new', work, picture])
    mkdirSync(work, { recursive: true }); writeFileSync(stamp, now + '\n')
    if (typeof flags.marks === 'string') step(['mark', work, '--set', resolve(flags.marks)])
    else if (!existsSync(marks) || marksStale) step(['mark', work, '--auto', ...(existsSync(marks) ? ['--force'] : [])])
    const source = typeof flags.source === 'string' ? flags.source : 'inflate'
    step(['shape', work, ...(typeof flags.mesh === 'string' ? ['--mesh', resolve(flags.mesh)] : ['--source', source, ...(source === 'space' ? ['--yes-upload'] : [])])])
    step(['build', work])
    step(['preview', work])
    copyHead(join(work, 'out'), join(P, headFolder))
    copyFileSync(picture, join(P, headFolder, basename(picture)))
    say(`head ready in ${join(P, headFolder)}. LOOK at ${join(work, 'out', 'preview.png')} before going on; fix marks with: ${H} mark ${work} --page`)
  },

  async audio({ rest }) { const P = projectDir(rest[0]); await audio(P) },

  async sheet({ rest, flags }) {
    const P = projectDir(rest[0])
    gate(P, flags)
    const { plan, head, outName } = loadPlan(P, flags, note)
    const r = await renderSheet({ P, plan, head, outName, log: note })
    say(r.out); say('beats: ' + plan.beats.map((b, i) => `${i + 1}=${b.label}@${b.t}s`).join('  '))
    reportIssues(r.issues)
  },

  async stills({ rest, flags }) {
    const P = projectDir(rest[0]), times = rest.slice(1).map(Number)
    if (!times.length || times.some((t) => !Number.isFinite(t))) throw new Error('stills needs one or more times in seconds, e.g. avatar stills <dir> 1.5 4')
    gate(P, flags)
    const { plan, head, outName } = loadPlan(P, flags, note)
    const r = await renderStills({ P, plan, head, outName, times: times.map((t) => Math.min(Math.max(0, t), plan.total)), log: note })
    for (const f of r.files) say(f)
    reportIssues(r.issues)
  },

  async video({ rest, flags }) { const P = projectDir(rest[0]); gate(P, flags); await video(P, flags) },

  async build({ rest, flags }) {
    const P = projectDir(rest[0]), issues = lint(P, flags)
    say(formatIssues(issues))
    if (issues.some((i) => i.level === 'error')) throw new Error('fix the errors above first')
    // the voice is remade when anything that shapes it changed (unchanged phrases come from the cache)
    let fresh = false
    try { fresh = timelineCheck(loadScript(P), readJson(join(P, 'build', 'timeline.json'))).stale.length === 0 } catch {}
    if (!fresh) await audio(P)
    const { plan, head, outName } = loadPlan(P, flags, note)
    const sheet = await renderSheet({ P, plan, head, outName, log: note })
    say(sheet.out)
    if (reportIssues(sheet.issues) && !flags.force) throw new Error('the layout has problems (above). Fix the script, or add --force to render anyway.')
    await video(P, { ...flags, web: true })
    const loop = await loopPreview({ P, outName, from: Number(flags['preview-from']) || (plan.panel ? Math.max(0, plan.panel.from - 1) : 1) })
    say(`${loop.webp}  (${(statSync(loop.webp).size / 1024).toFixed(0)} KB)\n${loop.gif}  (${(statSync(loop.gif).size / 1024).toFixed(0)} KB)`)
  },

  test: async () => process.exit(sh(process.execPath, ['--test', ...readdirSync(join(SKILL, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => join(SKILL, 'tests', f))])),
}

const [command = 'help', ...argv] = process.argv.slice(2)
try {
  const run = COMMANDS[command.replace(/^--?/, '')]
  if (!run) throw new Error(`unknown command "${command}". Run "avatar help".`)
  await run(parseArgs(argv))
} catch (e) {
  note('avatar: ' + (e && e.message || e))
  process.exit(1)
}
