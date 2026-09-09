'use strict'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 12 * 1000
const BUSY_STATES = new Set(['checking', 'downloading', 'installing'])

function cleanText(value, maxLength = 300) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function publicInfo(info) {
  if (!info || typeof info !== 'object') return {}
  return {
    version: cleanText(info.version, 80),
    releaseName: cleanText(info.releaseName, 160),
    releaseDate: cleanText(info.releaseDate, 80),
  }
}

function publicError(error) {
  const message = cleanText(error && error.message ? error.message : error, 400)
  return message || 'Неизвестная ошибка обновления'
}

function createUpdateController(options = {}) {
  const app = options.app
  const updater = options.updater || null
  const platform = options.platform || process.platform
  const publishState = typeof options.publishState === 'function' ? options.publishState : () => {}
  const logLine = typeof options.logLine === 'function' ? options.logLine : () => {}
  const setTimeoutFn = options.setTimeoutFn || setTimeout
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout
  const setIntervalFn = options.setIntervalFn || setInterval
  const clearIntervalFn = options.clearIntervalFn || clearInterval
  const setImmediateFn = options.setImmediateFn || setImmediate
  const supported = platform === 'win32' && !!(app && app.isPackaged && updater)
  const currentVersion = cleanText(app && typeof app.getVersion === 'function' ? app.getVersion() : '', 80)
  const listeners = []
  let startupTimer = null
  let intervalTimer = null
  let started = false
  let manualOperation = false
  let state = {
    supported,
    status: supported ? 'idle' : 'unsupported',
    currentVersion,
    version: '',
    releaseName: '',
    releaseDate: '',
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    manual: false,
    error: '',
  }

  const snapshot = () => Object.assign({}, state)
  const updateState = (patch) => {
    state = Object.assign({}, state, patch)
    publishState(snapshot())
    return snapshot()
  }
  const addListener = (event, handler) => {
    updater.on(event, handler)
    listeners.push([event, handler])
  }

  if (supported) {
    // The NSIS updater verifies the SHA-512 published in the release manifest.
    // Web installers are deliberately rejected: every release contains complete,
    // architecture-specific installers and can therefore be verified as one file.
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = currentVersion.includes('-')
    updater.allowDowngrade = false
    updater.disableWebInstaller = true

    addListener('checking-for-update', () => updateState({
      status: 'checking', manual: manualOperation, error: '', percent: 0,
      transferred: 0, total: 0, bytesPerSecond: 0,
    }))
    addListener('update-available', (info) => updateState(Object.assign({
      status: 'available', manual: manualOperation, error: '', percent: 0,
      transferred: 0, total: 0, bytesPerSecond: 0,
    }, publicInfo(info))))
    addListener('update-not-available', (info) => updateState(Object.assign({
      status: 'up-to-date', manual: manualOperation, error: '', percent: 0,
      transferred: 0, total: 0, bytesPerSecond: 0,
    }, publicInfo(info))))
    addListener('download-progress', (progress) => updateState({
      status: 'downloading',
      percent: Math.min(100, finiteNumber(progress && progress.percent)),
      transferred: finiteNumber(progress && progress.transferred),
      total: finiteNumber(progress && progress.total),
      bytesPerSecond: finiteNumber(progress && progress.bytesPerSecond),
      error: '',
    }))
    addListener('update-downloaded', (info) => updateState(Object.assign({
      status: 'downloaded', error: '', percent: 100,
    }, publicInfo(info))))
    addListener('error', (error) => {
      const message = publicError(error)
      logLine('[updater] ' + message)
      updateState({ status: 'error', manual: manualOperation, error: message })
    })
  }

  async function check(manual = false) {
    if (!supported) return snapshot()
    if (BUSY_STATES.has(state.status) || state.status === 'downloaded') return snapshot()
    manualOperation = manual === true
    updateState({ status: 'checking', manual: manualOperation, error: '' })
    try {
      await updater.checkForUpdates()
    } catch (error) {
      if (state.status !== 'error') {
        const message = publicError(error)
        logLine('[updater] ' + message)
        updateState({ status: 'error', manual: manualOperation, error: message })
      }
    }
    return snapshot()
  }

  async function download() {
    if (!supported || state.status !== 'available') return snapshot()
    manualOperation = true
    updateState({
      status: 'downloading', manual: true, error: '', percent: 0,
      transferred: 0, total: 0, bytesPerSecond: 0,
    })
    try {
      await updater.downloadUpdate()
    } catch (error) {
      if (state.status !== 'error') {
        const message = publicError(error)
        logLine('[updater] ' + message)
        updateState({ status: 'error', manual: true, error: message })
      }
    }
    return snapshot()
  }

  function install() {
    if (!supported || state.status !== 'downloaded') return snapshot()
    updateState({ status: 'installing', manual: true, error: '' })
    setImmediateFn(() => {
      try {
        updater.quitAndInstall(true, true)
      } catch (error) {
        const message = publicError(error)
        logLine('[updater] ' + message)
        updateState({ status: 'error', manual: true, error: message })
      }
    })
    return snapshot()
  }

  function start({ automatic = true } = {}) {
    if (!supported || started) return snapshot()
    started = true
    if (automatic) {
      startupTimer = setTimeoutFn(() => { void check(false) }, STARTUP_DELAY_MS)
      intervalTimer = setIntervalFn(() => { void check(false) }, CHECK_INTERVAL_MS)
      if (startupTimer && typeof startupTimer.unref === 'function') startupTimer.unref()
      if (intervalTimer && typeof intervalTimer.unref === 'function') intervalTimer.unref()
    }
    return snapshot()
  }

  function dispose() {
    if (startupTimer) clearTimeoutFn(startupTimer)
    if (intervalTimer) clearIntervalFn(intervalTimer)
    startupTimer = null
    intervalTimer = null
    for (const [event, handler] of listeners) updater.removeListener(event, handler)
    listeners.length = 0
  }

  return { getState: snapshot, check, download, install, start, dispose }
}

module.exports = {
  CHECK_INTERVAL_MS,
  STARTUP_DELAY_MS,
  cleanText,
  createUpdateController,
}
