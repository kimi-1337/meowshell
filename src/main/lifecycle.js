'use strict'

function cleanReason(value) {
  return String(value || 'shutdown')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'shutdown'
}

function createAppLifecycle({ app, logLine = () => {} }) {
  if (!app || typeof app.quit !== 'function' || typeof app.relaunch !== 'function') {
    throw new TypeError('Electron app lifecycle methods are required')
  }

  let shuttingDown = false
  let relaunchScheduled = false

  function begin(reason) {
    if (shuttingDown) return false
    shuttingDown = true
    logLine('[quit] запрос завершения: ' + cleanReason(reason))
    return true
  }

  function quit(reason) {
    begin(reason)
    app.quit()
  }

  function relaunch(args, reason) {
    // A renderer disappearing while its window is intentionally closing must
    // never turn the close operation into a new application instance.
    if (shuttingDown || relaunchScheduled) return false
    relaunchScheduled = true
    begin(reason || 'restart')
    app.relaunch({ args: Array.isArray(args) ? args.slice() : [] })
    // app.quit() runs Electron shutdown events and allows PTY/SSH resources to
    // be released. app.exit() would terminate the main process immediately.
    app.quit()
    return true
  }

  return {
    begin,
    isRelaunchScheduled: () => relaunchScheduled,
    isShuttingDown: () => shuttingDown,
    quit,
    relaunch,
  }
}

module.exports = { cleanReason, createAppLifecycle }
