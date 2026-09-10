'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { cleanReason, createAppLifecycle, isRendererCrash } = require('../src/main/lifecycle')

function fixture() {
  const calls = []
  const logs = []
  const app = {
    quit() { calls.push(['quit']) },
    relaunch(options) { calls.push(['relaunch', options]) },
  }
  return {
    app,
    calls,
    logs,
    lifecycle: createAppLifecycle({ app, logLine: (line) => logs.push(line) }),
  }
}

test('intentional window close cannot be converted into a relaunch', () => {
  const { calls, lifecycle, logs } = fixture()
  assert.equal(lifecycle.begin('window close'), true)
  assert.equal(lifecycle.begin('duplicate close'), false)
  assert.equal(lifecycle.relaunch(['app.js'], 'renderer crash'), false)
  assert.equal(lifecycle.isShuttingDown(), true)
  assert.equal(lifecycle.isRelaunchScheduled(), false)
  assert.deepEqual(calls, [])
  assert.equal(logs.length, 1)
})

test('requested restart is scheduled once and uses graceful quit', () => {
  const { calls, lifecycle } = fixture()
  const args = ['app.js', '--meowshell-safe-mode']
  assert.equal(lifecycle.relaunch(args, 'renderer recovery'), true)
  args.push('--mutated')
  assert.equal(lifecycle.relaunch([], 'duplicate recovery'), false)
  assert.deepEqual(calls, [
    ['relaunch', { args: ['app.js', '--meowshell-safe-mode'] }],
    ['quit'],
  ])
})

test('shutdown reasons are safe and bounded for local diagnostics', () => {
  assert.equal(cleanReason(' window\n\u0000 close '), 'window close')
  assert.equal(cleanReason('x'.repeat(500)).length, 160)
})

test('normal Windows renderer teardown is never treated as a crash', () => {
  assert.equal(isRendererCrash({ reason: 'clean-exit', exitCode: 0 }), false)
  assert.equal(isRendererCrash({ reason: 'killed', exitCode: 15 }), false)
  assert.equal(isRendererCrash({ reason: 'abnormal-exit', exitCode: 1 }), false)
  for (const reason of ['crashed', 'oom', 'launch-failed', 'integrity-failure']) {
    assert.equal(isRendererCrash({ reason }), true)
  }
})
