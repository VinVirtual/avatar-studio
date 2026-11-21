// A project folder: script.json, head/ (head.glb, head.json), build/ (voice and timeline), stills/ and out/.
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { makePlan, lineWords } from './plan.mjs'
import { FORMAT_NAMES } from './layout.mjs'

export function projectDir(dir) {
  if (!dir) throw new Error('which project? Give the project folder.')
  const P = resolve(dir)
  if (!existsSync(P) || !statSync(P).isDirectory()) throw new Error(`${dir} is not a folder. Start one with: avatar new ${dir}`)
  if (!existsSync(join(P, 'script.json'))) throw new Error(`no script.json in ${P}. Start a project with: avatar new <dir>`)
  return P
}

export function readJson(path, what = path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { throw new Error(`cannot read ${what}`) }
  try { return JSON.parse(text) } catch (e) { throw new Error(`${what} is not valid JSON: ${e.message}`) }
}

export const loadScript = (P) => readJson(join(P, 'script.json'), 'script.json')
export const headDir = (script) => script.head || 'head'

/** the words of every line in the script and in the timeline agree (else the voice is out of date) */
export function timelineMatches(script, timeline) {
  if (!Array.isArray(timeline.lines) || timeline.lines.length !== script.lines.length) return false
  return script.lines.every((l, i) => lineWords(l.say).join(' ') === timeline.lines[i].words.map((w) => w.w).join(' '))
}

export function loadTimeline(P, script) {
  const path = join(P, 'build', 'timeline.json')
  if (!existsSync(path)) throw new Error(`no voice yet. Run: avatar audio ${P}`)
  const tl = readJson(path, 'build/timeline.json')
  if (!timelineMatches(script, tl)) throw new Error(`the script's lines changed since the voice was made. Run: avatar audio ${P}`)
  return tl
}

/** the plan for a render, and the file name it uses ("<project>" or "<project>-<format>") */
export function loadPlan(P, flags = {}) {
  const script = loadScript(P)
  if (flags.format === true || (flags.format && !FORMAT_NAMES.includes(flags.format))) throw new Error(`--format needs one of: ${FORMAT_NAMES.join(', ')}`)
  const surface = readJson(join(P, headDir(script), 'head.json'), `${headDir(script)}/head.json`)
  const plan = makePlan(script, loadTimeline(P, script), { format: flags.format, captions: flags.captions === false ? false : undefined, surface })
  if (Number.isFinite(script.poster)) plan.poster = script.poster
  return { script, plan, head: headDir(script), outName: basename(P) + (flags.format ? `-${flags.format}` : '') }
}

/** --flag value, --flag, --no-flag; everything else is positional */
export function parseArgs(argv) {
  const flags = {}, rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--no-')) flags[a.slice(5)] = false
    else if (a.startsWith('--')) { const k = a.slice(2), v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { flags[k] = v; i++ } else flags[k] = true }
    else rest.push(a)
  }
  return { flags, rest }
}
