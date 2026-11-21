import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRequest } from '../engine/lib/server.mjs'

test('the render server only serves files inside its mounts', () => {
  const mounts = { project: '/srv/p' }
  assert.equal(resolveRequest(mounts, '/project/head/head.glb'), '/srv/p/head/head.glb')
  assert.equal(resolveRequest(mounts, '/project/../secret'), null)
  assert.equal(resolveRequest(mounts, '/project/%2e%2e/secret'), null)
  assert.equal(resolveRequest(mounts, '/other/x'), null)
  assert.equal(resolveRequest(mounts, '/project'), null)
})
