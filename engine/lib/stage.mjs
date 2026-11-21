// The stage: a browser with one or two pages, each holding the render page set up with a plan, ready to draw frames.
import { join } from 'node:path'
import { ENGINE, SKILL, findTalkingHead, talkingHeadHint, findThree, launchBrowser } from './env.mjs'
import { serve } from './server.mjs'

export const MAX_PAGES = 2

/** Open `pages` pages (at most MAX_PAGES). Returns { pages, size, issues, close }. */
export async function openStage({ P, plan, head, pages = 1, log = console.error }) {
  const th = findTalkingHead()
  if (!th) throw new Error(talkingHeadHint())
  const three = findThree(th)
  if (!three) throw new Error(`three.js was not found. Run "npm install" in ${SKILL} (or in talking-head's folder), or set AVATAR_THREE`)
  const server = await serve({ page: join(ENGINE, 'page'), lib: join(ENGINE, 'lib'), fonts: join(SKILL, 'assets', 'fonts'), viewer: join(th, 'viewer'), three, project: P })
  const said = new Set(), once = (m) => { if (!said.has(m)) { said.add(m); log(m) } }
  let browser
  try {
    browser = await launchBrowser()
    const list = []
    let info
    for (let i = 0; i < Math.min(MAX_PAGES, Math.max(1, pages)); i++) {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
      page.on('pageerror', (e) => once('page error: ' + e.message))
      page.on('console', (m) => m.type() === 'error' && once('page: ' + m.text()))
      await page.goto(`${server.url}/page/index.html`)
      await page.waitForFunction(() => typeof window.setup === 'function', null, { timeout: 30000 })
      info = await page.evaluate(([p, h]) => window.setup(p, h), [plan, head])
      list.push(page)
    }
    const issues = async () => [...new Set((await Promise.all(list.map((p) => p.evaluate(() => window.issues())))).flat())]
    return { pages: list, size: info, issues, close: async () => { await browser.close().catch(() => {}); await server.close() } }
  } catch (e) {
    await browser?.close().catch(() => {}); await server.close()
    throw e
  }
}

/** one frame: { image (Buffer), mouth } */
export async function grab(page, t, type = 'png', quality = 0.92) {
  const r = await page.evaluate(([t, type, quality]) => window.grab(t, type, quality), [t, type, quality])
  return { image: Buffer.from(r.data, 'base64'), mouth: r.mouth }
}
