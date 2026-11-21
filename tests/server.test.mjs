import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { resolveRequest, hostAllowed, serve } from '../engine/lib/server.mjs'

let dir, project, outside, server
before(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'avatar-server-')))
  project = join(dir, 'project'); outside = join(dir, 'outside')
  mkdirSync(join(project, 'head'), { recursive: true }); mkdirSync(outside)
  writeFileSync(join(project, 'head', 'head.json'), '{"ok":true}')
  writeFileSync(join(project, 'script.json'), '{}')
  writeFileSync(join(project, '.env'), 'SECRET=1')
  writeFileSync(join(project, 'notes.txt'), 'text')
  writeFileSync(join(project, 'locked.json'), '{}'); chmodSync(join(project, 'locked.json'), 0o000)
  writeFileSync(join(outside, 'secret.json'), '{"secret":true}')
  symlinkSync(join(outside, 'secret.json'), join(project, 'link.json'))
  symlinkSync(outside, join(project, 'escape'))
  server = await serve({ project })
})
after(async () => { await server.close(); chmodSync(join(project, 'locked.json'), 0o644); rmSync(dir, { recursive: true, force: true }) })

/** a raw request, so the Host header can be anything */
const get = (path, host = `127.0.0.1:${server.port}`, method = 'GET') => new Promise((done, fail) => {
  const req = request({ host: '127.0.0.1', port: server.port, path, method, headers: { host } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d }); res.on('end', () => done({ status: res.statusCode, type: res.headers['content-type'], body }))
  })
  req.on('error', fail); req.end()
})

test('resolveRequest serves files inside a mount only', () => {
  const mounts = { project }
  assert.equal(resolveRequest(mounts, '/project/head/head.json'), join(project, 'head', 'head.json'))
  for (const bad of ['/project/../outside/secret.json', '/project/%2e%2e/outside/secret.json', '/other/x.json', '/project',
    '/constructor/x.json', '/__proto__/x.json', '/toString/x.json', '/project/.env', '/project/notes.txt', '/project/link.json',
    '/project/escape/secret.json', '/project/head', '/project/head%5c..%5c..%5coutside%5csecret.json', '/project//script.json'])
    assert.equal(resolveRequest(mounts, bad), null, bad)
})

test('hostAllowed accepts only this server by IP or localhost', () => {
  assert.ok(hostAllowed('127.0.0.1:4000', 4000) && hostAllowed('localhost:4000', 4000))
  assert.ok(!hostAllowed('evil.example:4000', 4000) && !hostAllowed('127.0.0.1:4001', 4000) && !hostAllowed(undefined, 4000))
})

test('HTTP: a project file is served with its type', async () => {
  const r = await get('/project/head/head.json')
  assert.equal(r.status, 200); assert.equal(r.type, 'application/json'); assert.equal(r.body, '{"ok":true}')
  assert.equal((await get('/project/head/head.json', `localhost:${server.port}`)).status, 200)
})

test('HTTP: another Host is refused (DNS rebinding)', async () => {
  assert.equal((await get('/project/head/head.json', `attacker.example:${server.port}`)).status, 403)
})

test('HTTP: prototype names, dot-files, other types, symlinks out and traversal get 404, and the server keeps answering', async () => {
  for (const path of ['/constructor/x.json', '/hasOwnProperty/x.json', '/project/.env', '/project/notes.txt', '/project/link.json',
    '/project/escape/secret.json', '/project/..%2f..%2foutside/secret.json'])
    assert.equal((await get(path)).status, 404, path)
  assert.equal((await get('/project/head/head.json')).status, 200)
})

test('HTTP: a file that cannot be read does not crash the server', { skip: process.getuid?.() === 0 && 'root can read anything' }, async () => {
  assert.equal((await get('/project/locked.json')).status, 404)
  assert.equal((await get('/project/script.json')).status, 200)
})

test('HTTP: only GET and HEAD', async () => {
  assert.equal((await get('/project/script.json', undefined, 'POST')).status, 405)
  assert.equal((await get('/project/script.json', undefined, 'HEAD')).status, 200)
})
