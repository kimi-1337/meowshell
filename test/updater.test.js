'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { CHECK_INTERVAL_MS, STARTUP_DELAY_MS, cleanText, createUpdateController } = require('../src/main/updater')

class FakeUpdater extends EventEmitter {
  constructor() {
    super()
    this.checks = 0
    this.downloads = 0
    this.installs = 0
  }

  async checkForUpdates() { this.checks += 1 }
  async downloadUpdate() { this.downloads += 1 }
  quitAndInstall(silent, forceRunAfter) {
    this.installs += 1
    this.installArgs = [silent, forceRunAfter]
  }
}

function fixture(overrides = {}) {
  const updater = new FakeUpdater()
  const published = []
  const immediate = []
  const timers = []
  const intervals = []
  const controller = createUpdateController(Object.assign({
    app: { isPackaged: true, getVersion: () => '2.3.0-beta.4' },
    updater,
    platform: 'win32',
    publishState: (state) => published.push(state),
    setTimeoutFn: (fn, delay) => { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer },
    clearTimeoutFn: () => {},
    setIntervalFn: (fn, delay) => { const timer = { fn, delay, unref() {} }; intervals.push(timer); return timer },
    clearIntervalFn: () => {},
    setImmediateFn: (fn) => immediate.push(fn),
  }, overrides))
  return { controller, updater, published, immediate, timers, intervals }
}

test('updater is disabled outside packaged Windows builds', async () => {
  const { controller, updater } = fixture({ platform: 'linux' })
  assert.equal(controller.getState().status, 'unsupported')
  assert.equal(controller.getState().supported, false)
  await controller.check(true)
  await controller.download()
  controller.install()
  assert.equal(updater.checks, 0)
  assert.equal(updater.downloads, 0)
  assert.equal(updater.installs, 0)
})

test('safe updater flags and recurring checks are configured', async () => {
  const { controller, updater, timers, intervals } = fixture()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowPrerelease, true)
  assert.equal(updater.allowDowngrade, false)
  assert.equal(updater.disableWebInstaller, true)
  controller.start()
  assert.equal(timers[0].delay, STARTUP_DELAY_MS)
  assert.equal(intervals[0].delay, CHECK_INTERVAL_MS)
  timers[0].fn()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updater.checks, 1)
})

test('update can be checked, downloaded, and installed with progress', async () => {
  const { controller, updater, immediate } = fixture()
  await controller.check(true)
  updater.emit('update-available', {
    version: '2.3.0-beta.5',
    releaseName: '<b>Beta 5</b>\n',
    releaseDate: '2026-09-10T10:00:00.000Z',
    releaseNotes: '<script>never expose this</script>',
  })
  assert.deepEqual(controller.getState(), {
    supported: true,
    status: 'available',
    currentVersion: '2.3.0-beta.4',
    version: '2.3.0-beta.5',
    releaseName: '<b>Beta 5</b>',
    releaseDate: '2026-09-10T10:00:00.000Z',
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    manual: true,
    error: '',
  })
  assert.equal('releaseNotes' in controller.getState(), false)

  const download = controller.download()
  updater.emit('download-progress', { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 120 })
  await download
  assert.equal(updater.downloads, 1)
  assert.equal(controller.getState().percent, 42.5)
  updater.emit('update-downloaded', { version: '2.3.0-beta.5' })
  assert.equal(controller.getState().status, 'downloaded')

  controller.install()
  assert.equal(controller.getState().status, 'installing')
  assert.equal(updater.installs, 0)
  immediate.shift()()
  assert.equal(updater.installs, 1)
  assert.deepEqual(updater.installArgs, [true, true])
})

test('errors and release metadata are bounded before reaching the renderer', async () => {
  const { controller, updater } = fixture()
  await controller.check(true)
  updater.emit('error', new Error('bad\u0000\n' + 'x'.repeat(1000)))
  assert.equal(controller.getState().status, 'error')
  assert.equal(controller.getState().error.includes('\u0000'), false)
  assert.equal(controller.getState().error.length, 400)
  assert.equal(cleanText(' a\n\tb '), 'a b')
})
