// A small file server on this machine (127.0.0.1 only) for the render page: the page, the shared modules,
// fonts, talking-head's viewer, three.js and the project's files.
// It answers only requests addressed to itself (Host 127.0.0.1:<port> or localhost:<port>), only for the file
// types the page loads, never for dot-files, and never outside a mount, symlinks included.
import { createServer } from 'node:http'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { resolve, sep, extname } from 'node:path'

export const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ttf': 'font/ttf' }

const inside = (root, file) => file === root ? false : file.startsWith(root.endsWith(sep) ? root : root + sep)

/** the file a request asks for inside `mounts` ({ prefix: folder }), or null when it may not be served */
export function resolveRequest(mounts, url) {
  let path
  try { path = decodeURIComponent(new URL(url, 'http://x').pathname) } catch { return null }
  if (path.includes('\0') || path.includes('\\')) return null
  const [, prefix, ...rest] = path.split('/')
  if (!prefix || !Object.hasOwn(mounts, prefix) || !rest.length) return null
  if (rest.some((part) => !part || part.startsWith('.'))) return null // no dot-files, no "..", no empty parts
  if (!Object.hasOwn(TYPES, extname(rest[rest.length - 1]).toLowerCase())) return null
  const root = resolve(mounts[prefix]), file = resolve(root, ...rest)
  if (!inside(root, file)) return null
  let real
  try { real = realpathSync(file); if (!inside(realpathSync(root), real) || !statSync(real).isFile()) return null } catch { return null }
  return real
}

/** whether the Host header names this server */
export const hostAllowed = (host, port) => host === `127.0.0.1:${port}` || host === `localhost:${port}`

/** start serving; resolves to { url, port, close } */
export function serve(mounts) {
  const server = createServer((req, res) => {
    const deny = (code, text) => { if (!res.headersSent) res.writeHead(code, { 'content-type': 'text/plain' }); res.end(text) }
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'only GET')
    if (!hostAllowed(req.headers.host, server.address().port)) return deny(403, 'wrong host')
    const file = resolveRequest(mounts, req.url)
    if (!file) return deny(404, 'not found')
    const stream = createReadStream(file)
    stream.on('error', () => deny(404, 'not readable'))
    stream.on('open', () => {
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      if (req.method === 'HEAD') { stream.destroy(); res.end() } else stream.pipe(res)
    })
  })
  server.on('clientError', (_, socket) => socket.destroy())
  return new Promise((done, fail) => {
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      done({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(r)) })
    })
  })
}
