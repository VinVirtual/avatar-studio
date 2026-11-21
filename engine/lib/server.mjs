// A small file server on this machine (127.0.0.1 only) for the render page: the page, the shared modules,
// fonts, talking-head's viewer, three.js and the project's files. Each mount serves only inside its folder.
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

/** the file a request asks for inside `mounts` ({ prefix: folder }), or null when it is outside them */
export function resolveRequest(mounts, url) {
  let path
  try { path = decodeURIComponent(new URL(url, 'http://x').pathname) } catch { return null }
  const [, prefix, ...rest] = path.split('/')
  const root = mounts[prefix]
  if (!root || !rest.length) return null
  const file = resolve(root, ...rest)
  return file.startsWith(resolve(root) + sep) ? file : null
}

/** start serving; resolves to { url, close } */
export function serve(mounts) {
  const server = createServer((req, res) => {
    const file = resolveRequest(mounts, req.url)
    let ok = false
    try { ok = !!file && statSync(file).isFile() } catch {}
    if (!ok) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    createReadStream(file).pipe(res)
  })
  return new Promise((done, fail) => {
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => done({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }))
  })
}
