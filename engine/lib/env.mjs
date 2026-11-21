// Where avatar-studio finds its tools: talking-head, three.js, Python + Kokoro, ffmpeg, Playwright and a browser.
// Every location has a default and an environment variable that overrides it (README.md, "Install").
// Adapted from reel-studio's engine/lib/env.mjs (MIT, same author).
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const SKILL = resolve(ENGINE, '..')
export const KOKORO_HOME = process.env.KOKORO_HOME || join(homedir(), 'kokoro')

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const onPath = (name) => { try { return run('which', [name]).split('\n')[0] || null } catch { return null } }

/** talking-head's folder: $TALKING_HEAD_DIR, else ~/.claude/skills/talking-head. Returns null when it is not there. */
export function findTalkingHead() {
  const dir = resolve(process.env.TALKING_HEAD_DIR || join(homedir(), '.claude', 'skills', 'talking-head'))
  return existsSync(join(dir, 'viewer', 'viewer.js')) && existsSync(join(dir, 'head')) ? dir : null
}
export const talkingHeadHint = () => 'talking-head is not installed. Put it in ~/.claude/skills/talking-head, or set TALKING_HEAD_DIR to its folder.'

/** three.js (the folder with build/three.module.js): $AVATAR_THREE, avatar-studio's node_modules, talking-head's node_modules */
export function findThree(th = findTalkingHead()) {
  for (const place of [process.env.AVATAR_THREE, join(SKILL, 'node_modules', 'three'), th && join(th, 'node_modules', 'three')]) {
    if (place && existsSync(join(place, 'build', 'three.module.js'))) return place
  }
  return null
}

/** Python that can import kokoro_onnx: $AVATAR_PYTHON, else the venv in $KOKORO_HOME, else python3 on PATH. */
export function findPython() {
  if (process.env.AVATAR_PYTHON) return process.env.AVATAR_PYTHON
  const venv = join(KOKORO_HOME, '.venv', 'bin', 'python')
  return existsSync(venv) ? venv : onPath('python3') || 'python3'
}

/** ffmpeg: $FF, else ffmpeg on PATH, else the binary that the imageio-ffmpeg Python package ships. */
export function findFF() {
  if (process.env.FF) return process.env.FF
  const sys = onPath('ffmpeg'); if (sys) return sys
  try { return run(findPython(), ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']) } catch {}
  throw new Error('ffmpeg not found. Install ffmpeg, or run `pip install imageio-ffmpeg` in the Kokoro venv, or set FF=/path/to/ffmpeg')
}

/** Playwright's chromium launcher and where it was loaded from. */
export function findPlaywright() {
  const require = createRequire(import.meta.url)
  let root = ''; try { root = run('npm', ['root', '-g']) } catch {}
  const cands = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'playwright', join(process.cwd(), 'node_modules', 'playwright-core'),
    root && join(root, 'playwright-core'), root && join(root, 'playwright'), root && join(root, '@playwright/cli/node_modules/playwright-core'),
    root && join(root, '@playwright/test/node_modules/playwright-core')].filter(Boolean)
  for (const c of cands) { try { return { chromium: require(c).chromium, from: c } } catch {} }
  throw new Error('Playwright not found. Run `npm i -g playwright-core`, or set PLAYWRIGHT_CORE=/path/to/playwright-core')
}

const BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

/** Start a browser: $AVATAR_CHROME, an installed Chrome or Chromium, else Playwright's own. Throws with what was tried. */
export async function launchBrowser() {
  const { chromium } = findPlaywright(), tried = []
  // WebGL in a headless browser: ANGLE on SwiftShader works with no GPU (and gives the same pixels every run)
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  const cands = [process.env.AVATAR_CHROME, ...BROWSERS.map(onPath)].filter((p) => p && existsSync(p)).map((p) => ({ executablePath: p }))
  cands.push({})
  for (const c of cands) {
    try { return await chromium.launch({ ...c, args, timeout: 60000 }) } catch (e) { tried.push(`${c.executablePath || "Playwright's own Chromium"}: ${String(e.message).split('\n')[0]}`) }
  }
  throw new Error(['No browser could be started. Tried:', ...tried.map((t) => '  - ' + t), 'Install Google Chrome or Chromium, or set AVATAR_CHROME=/path/to/chrome'].join('\n'))
}
