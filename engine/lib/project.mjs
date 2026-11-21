// A project folder: script.json, head/ (head.glb, head.json), build/ (voice and timeline), stills/ and out/.
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs'
import { join, resolve, basename, sep } from 'node:path'
import { safeHeadPath } from './lint.mjs'
import { makePlan, timelineCheck } from './plan.mjs'
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
/** the head folder named by the script, refused unless it is a folder inside the project */
export function headDir(script, P) {
  const head = script.head ?? 'head'
  if (!safeHeadPath(head)) throw new Error(`"head": ${JSON.stringify(head)} must be a folder inside the project (relative, no "..")`)
  if (P && existsSync(join(P, head))) {
    const root = realpathSync(P), real = realpathSync(join(P, head))
    if (!real.startsWith(root + sep)) throw new Error(`"head": ${head} leads outside the project (a link?)`)
  }
  return head
}

/** the timeline made by "avatar audio", refused when anything that shapes the voice or timing changed since */
export function loadTimeline(P, script, warn = () => {}) {
  const path = join(P, 'build', 'timeline.json')
  if (!existsSync(path)) throw new Error(`no voice yet. Run: avatar audio ${P}`)
  const tl = readJson(path, 'build/timeline.json')
  const { stale, warnings } = timelineCheck(script, tl)
  if (stale.includes('version')) throw new Error(`the voice was made by an older version of avatar-studio. Run: avatar audio ${P}`)
  if (stale.length) throw new Error(`the voice is out of date: ${stale.join(', ')} changed in script.json since it was made. Run: avatar audio ${P}`)
  warnings.forEach((w) => warn('warning: ' + w))
  return tl
}

/** the plan for a render, and the file name it uses ("<project>" or "<project>-<format>") */
export function loadPlan(P, flags = {}, warn = () => {}) {
  const script = loadScript(P), head = headDir(script, P)
  if (flags.format === true || (flags.format && !FORMAT_NAMES.includes(flags.format))) throw new Error(`--format needs one of: ${FORMAT_NAMES.join(', ')}`)
  const surface = readJson(join(P, head, 'head.json'), `${head}/head.json`)
  const plan = makePlan(script, loadTimeline(P, script, warn), { format: flags.format, captions: flags.captions === false ? false : undefined, surface })
  if (Number.isFinite(script.poster)) plan.poster = script.poster
  return { script, plan, head, outName: basename(P) + (flags.format ? `-${flags.format}` : '') }
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
