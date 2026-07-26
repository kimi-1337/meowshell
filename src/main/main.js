const { app, BrowserWindow, ipcMain, dialog, clipboard, safeStorage, shell, session, globalShortcut, screen, crashReporter, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const {
  normalizeConfig,
  quotePathForShell,
  quotePosix,
  resolveLocalChild,
  safeEntryName,
  validPort,
} = require('./utils')

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

// ---------- защита от «молчаливых» падений ----------
// Если в главном процессе что-то падает, показываем окно с ошибкой
// и пишем лог в %TEMP%\meowshell-error.log, чтобы можно было разобраться.
const errorLogPath = path.join(os.tmpdir(), 'meowshell-error.log')
try {
  if (fs.statSync(errorLogPath).size > 5 * 1024 * 1024) {
    const previous = errorLogPath + '.1'
    try { fs.unlinkSync(previous) } catch {}
    fs.renameSync(errorLogPath, previous)
  }
} catch {}

function reportFatal(err) {
  const text = (err && err.stack) || String(err)
  try {
    fs.appendFileSync(
      errorLogPath,
      new Date().toISOString() + '\n' + text + '\n\n'
    )
  } catch {}
  try { dialog.showErrorBox(mt('MeowShell — Error', 'MeowShell — ошибка'), text) } catch {}
}
process.on('uncaughtException', reportFatal)
process.on('unhandledRejection', reportFatal)

// v2.0.2: диагностика «молчаливого» закрытия
function logLine(msg) {
  try {
    fs.appendFileSync(
      errorLogPath,
      new Date().toISOString() + ' ' + msg + '\n'
    )
  } catch {}
}
logLine('[start] MeowShell ' + app.getVersion() + ' | electron ' + process.versions.electron + ' | packaged=' + app.isPackaged + ' | ' + process.platform + ' ' + os.release())

// Если в прошлый раз упал GPU/renderer — запускаемся без аппаратного ускорения.
function gpuMarkerPath() {
  try { return path.join(app.getPath('userData'), 'disable-gpu') } catch { return null }
}

function enableSafeGpuMode(reason) {
  const marker = gpuMarkerPath()
  if (!marker) return false
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, new Date().toISOString() + ' ' + String(reason || 'unknown') + '\n', { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

function isSafeGpuMode() {
  const marker = gpuMarkerPath()
  return !!(marker && fs.existsSync(marker))
}

const startedInSafeMode = isSafeGpuMode() || process.argv.includes('--meowshell-safe-mode')
const ciSmokeTest = process.argv.includes('--meowshell-ci-smoke')
try {
  crashReporter.start({ productName: 'MeowShell', companyName: 'MeowShell', uploadToServer: false })
  logLine('[crash-reporter] dumps: ' + app.getPath('crashDumps'))
} catch (err) {
  logLine('[crash-reporter] не запущен: ' + err.message)
}
try {
  if (startedInSafeMode) {
    app.disableHardwareAcceleration()
    // На части Windows 10 машин ломается именно sandbox GPU-процесса Chromium.
    // Renderer остаётся sandboxed; исключение касается только уже отключённого GPU.
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-gpu-sandbox')
    logLine('[gpu] безопасный режим: GPU и его sandbox выключены')
  }
} catch {}

let isQuitting = false
app.on('before-quit', () => { isQuitting = true })
app.on('render-process-gone', (event, webContents, details) => {
  const reason = details ? details.reason + ' (код ' + details.exitCode + ')' : '?'
  logLine('[crash] процесс окна упал: ' + reason)
  if (ciSmokeTest) return app.exit(1)
  if (isQuitting || !details || details.reason === 'clean-exit') return
  enableSafeGpuMode('renderer: ' + reason)
  if (!startedInSafeMode) {
    logLine('[recovery] перезапуск приложения в безопасном режиме')
    try {
      app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--meowshell-safe-mode').concat('--meowshell-safe-mode') })
      app.exit(0)
    } catch (err) {
      reportFatal(err)
    }
    return
  }
  reportFatal(new Error('Окно аварийно завершилось даже в безопасном режиме: ' + reason + '\nЛог: %TEMP%\\meowshell-error.log\nДампы: ' + app.getPath('crashDumps')))
})
app.on('child-process-gone', (event, details) => {
  if (!details) return
  logLine('[crash] служебный процесс упал: ' + details.type + ' / ' + details.reason)
  if (details.type === 'GPU' && (details.reason === 'crashed' || details.reason === 'launch-failed')) {
    enableSafeGpuMode('GPU: ' + details.reason)
  }
})
app.on('will-quit', () => logLine('[quit] приложение завершилось'))

// node-pty — локальные терминалы. Обёрнуто в try, чтобы приложение
// запускалось даже если модуль не собрался (SSH будет работать всё равно).
let pty = null
try {
  pty = require('@lydell/node-pty')
} catch (err) {
  console.warn('node-pty недоступен:', err.message)
}

const { Client } = require('ssh2')

let win = null
let nextId = 1
const sessions = new Map() // id -> { type, write, resize, kill, client? }
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

// ---------- конфиг (сохранённые подключения + настройки) ----------

function configPath() {
  return path.join(app.getPath('userData'), 'meowshell-config.json')
}

function migrateLegacySecrets(cfg) {
  let changed = false
  for (const connection of cfg.connections) {
    for (const field of ['password', 'passphrase']) {
      const value = connection[field]
      if (typeof value === 'string' && value && !value.startsWith('enc:')) {
        try {
          connection[field] = encSecret(value)
          changed = true
        } catch {}
      }
    }
  }
  if (changed) saveConfig(cfg)
  return cfg
}

function loadConfig() {
  try {
    return migrateLegacySecrets(normalizeConfig(JSON.parse(fs.readFileSync(configPath(), 'utf8'))))
  } catch {}
  // миграция со старого MyTerm: подхватываем прежний конфиг,
  // чтобы не потерять сохранённые серверы и настройки
  try {
    const appData = app.getPath('appData')
    const candidates = [
      path.join(app.getPath('userData'), 'myterm-config.json'),
      ...['MyTerm', 'myterm'].map((oldDir) => path.join(appData, oldDir, 'myterm-config.json')),
    ]
    for (const oldFile of candidates) {
      if (fs.existsSync(oldFile)) {
        const cfg = normalizeConfig(JSON.parse(fs.readFileSync(oldFile, 'utf8')))
        saveConfig(cfg)
        return migrateLegacySecrets(cfg)
      }
    }
  } catch {}
  return normalizeConfig(null)
}

function uiLanguage() {
  let language = 'auto'
  try { language = loadConfig().settings.language || 'auto' } catch {}
  if (language === 'ru' || language === 'en') return language
  try { return /^ru(?:-|$)/i.test(app.getLocale()) ? 'ru' : 'en' } catch { return 'en' }
}

function mt(english, russian) {
  return uiLanguage() === 'ru' ? russian : english
}

function saveConfig(cfg) {
  try {
    const file = configPath()
    const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(normalizeConfig(cfg), null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
    try { fs.chmodSync(file, 0o600) } catch {}
    return true
  } catch (err) {
    console.error('Не удалось сохранить конфиг:', err.message)
    return false
  }
}

function backupConfig(label = 'backup') {
  const source = configPath()
  if (!fs.existsSync(source)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const target = path.join(path.dirname(source), 'backups', 'meowshell-' + label + '-' + stamp + '.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  try { fs.chmodSync(target, 0o600) } catch {}
  return target
}

function exportableConfig(cfg) {
  const normalized = normalizeConfig(cfg)
  const settings = Object.assign({}, normalized.settings)
  delete settings.bgImage
  delete settings.lastTabs
  delete settings.onboardingComplete
  return {
    format: 'meowshell-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    containsSecrets: false,
    settings,
    connections: normalized.connections.map((connection) => {
      const clean = Object.assign({}, connection)
      delete clean.password
      delete clean.passphrase
      delete clean.keyPath
      return clean
    }),
  }
}

function importedConfig(value) {
  if (!value || typeof value !== 'object' || value.format !== 'meowshell-config' || value.version !== 1) {
    throw new Error('Unsupported MeowShell configuration format')
  }
  const normalized = normalizeConfig(value)
  for (const deviceSpecific of [
    'shell', 'bgImage', 'lastTabs', 'onboardingComplete', 'quakeEnabled',
    'quakeHotkey', 'restoreTabs',
  ]) delete normalized.settings[deviceSpecific]
  normalized.connections = normalized.connections.slice(0, 1000).map((connection) => ({
    id: Date.now().toString(36) + crypto.randomBytes(5).toString('hex'),
    name: String(connection.name || '').trim().slice(0, 200),
    host: String(connection.host || '').trim().slice(0, 253),
    port: validPort(connection.port, 22),
    username: String(connection.username || '').trim().slice(0, 128),
    keyPath: String(connection.keyPath || '').trim().slice(0, 4096),
    tunnels: Array.isArray(connection.tunnels) ? connection.tunnels.slice(0, 100) : [],
    password: '',
    passphrase: '',
  })).filter((connection) => connection.host && connection.username)
  normalized.knownHosts = {}
  return normalized
}

// ---------- шифрование паролей (Windows DPAPI через safeStorage) ----------

function encSecret(v) {
  if (!v) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(String(v)).toString('base64')
    }
  } catch (err) {
    throw new Error('Системное шифрование секретов недоступно: ' + err.message)
  }
  throw new Error('Системное шифрование секретов недоступно. Пароль не сохранён.')
}

function decSecret(v) {
  if (!v) return ''
  if (typeof v === 'string' && v.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  return v
}

// Renderer получает только признаки наличия секретов. Сами пароли остаются в main.
function cfgView(cfg) {
  const safeMode = isSafeGpuMode()
  let backgroundResourceUrl = ''
  try {
    const background = path.resolve(String(cfg.settings && cfg.settings.bgImage || ''))
    if (/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(background) && fs.statSync(background).isFile()) {
      backgroundResourceUrl = registerLocalResource(background)
    }
  } catch {}
  return {
    settings: Object.assign({}, cfg.settings || {}, safeMode ? { webglRenderer: false } : {}),
    safeMode,
    backgroundResourceUrl,
    securityWarning: (cfg.connections || []).some((c) =>
      [c.password, c.passphrase].some((value) => typeof value === 'string' && value && !value.startsWith('enc:'))
    ) ? 'В старой конфигурации остались незашифрованные секреты: системное шифрование сейчас недоступно.' : '',
    connections: (cfg.connections || []).map((c) =>
      Object.assign({}, c, {
        password: undefined,
        passphrase: undefined,
        hasPassword: !!c.password,
        hasPassphrase: !!c.passphrase,
      })
    ),
  }
}

function resolveSshConfig(input) {
  const source = input && typeof input === 'object' ? input : {}
  const id = typeof source.id === 'string' ? source.id : ''
  const saved = id ? loadConfig().connections.find((item) => item.id === id) : null
  const pick = (key, fallback = '') => Object.prototype.hasOwnProperty.call(source, key)
    ? source[key]
    : (saved && saved[key]) || fallback
  return {
    id,
    host: pick('host'),
    port: validPort(pick('port', 22), 22),
    username: pick('username'),
    keyPath: pick('keyPath'),
    password: source.password || decSecret(saved && saved.password),
    passphrase: source.passphrase || decSecret(saved && saved.passphrase),
    cols: Math.min(1000, Math.max(2, Number(source.cols) || 80)),
    rows: Math.min(500, Math.max(1, Number(source.rows) || 24)),
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const rendererUrl = 'app://meowshell/src/renderer/index.html'
const localResources = new Map()
const selectedLocalFiles = new Set()
const uploadGrants = new Map()

function registerLocalResource(filePath) {
  const absolute = path.resolve(String(filePath || ''))
  const token = crypto.createHash('sha256').update(absolute).digest('hex')
  localResources.set(token, absolute)
  return 'app://meowshell/.local-resource/' + token
}

function appResourcePath(url) {
  const root = path.resolve(app.getAppPath())
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const target = path.resolve(root, pathname)
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null
  return target
}

function isTrustedSender(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false
  const url = (event.senderFrame && event.senderFrame.url) || event.sender.getURL()
  return url === rendererUrl
}

function onIpc(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) return
    handler(event, ...args)
  })
}

function handleIpc(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный IPC-отправитель')
    return handler(event, ...args)
  })
}

// ---------- окно ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 820,
    minHeight: 480,
    backgroundColor: '#0a0a0c',
    title: 'MeowShell',
    autoHideMenuBar: true,
    frame: false, // своя минималистичная шапка вместо системной рамки
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === rendererUrl) return
    event.preventDefault()
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.href)
    } catch {}
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.href)
    } catch {}
    return { action: 'deny' }
  })
  win.loadURL(rendererUrl)
  if (ciSmokeTest) {
    win.webContents.once('did-fail-load', () => app.exit(1))
  }
  // сообщаем рендереру о развёртывании — чтобы менять иконку кнопки в шапке
  win.on('maximize', () => send('win:max-state', true))
  win.on('unmaximize', () => send('win:max-state', false))
}

// ---------- кнопки собственной шапки окна ----------
onIpc('win:minimize', () => { if (win) win.minimize() })
onIpc('win:maximize-toggle', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
onIpc('win:close', () => { if (win) win.close() })

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url)
      const localMatch = url.pathname.match(/^\/\.local-resource\/([a-f0-9]{64})$/)
      const target = url.hostname !== 'meowshell'
        ? null
        : (localMatch ? localResources.get(localMatch[1]) : appResourcePath(url))
      if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(target).href)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  createWindow()
})

app.on('window-all-closed', () => {
  for (const s of sessions.values()) {
    try { s.kill() } catch {}
  }
  app.quit()
})

// ---------- локальный терминал (PTY) ----------

handleIpc('session:create-local', (e, opts = {}) => {
  if (!pty) {
    return { error: 'node-pty не установлен. Выполни `npm install` (или `npm rebuild`) и перезапусти приложение.' }
  }
  const defShell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || 'bash')
  const shell = String(opts.shell || defShell).trim() || defShell
  const id = String(nextId++)
  // Включаем UTF-8 в локальных шеллах, чтобы юникод-символы не превращались в «?»
  let shellArgs = []
  if (/cmd\.exe$/i.test(shell)) {
    shellArgs = ['/K', 'chcp 65001 >nul']
  } else if (/powershell\.exe$/i.test(shell)) {
    shellArgs = [
      '-NoLogo', '-NoExit', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::InputEncoding=[System.Text.Encoding]::UTF8; Clear-Host',
    ]
  }
  let p
  try {
    const terminalEnv = Object.assign({}, process.env, {
      TERM: process.env.TERM || 'xterm-256color',
      COLORTERM: process.env.COLORTERM || 'truecolor',
      TERM_PROGRAM: 'MeowShell',
      TERM_PROGRAM_VERSION: app.getVersion(),
    })
    p = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: Math.min(1000, Math.max(2, Number(opts.cols) || 80)),
      rows: Math.min(500, Math.max(1, Number(opts.rows) || 24)),
      cwd: os.homedir(),
      env: terminalEnv,
    })
  } catch (err) {
    return { error: 'Не удалось запустить "' + shell + '": ' + err.message }
  }
  p.onData((data) => send('session:data', { id, data }))
  p.onExit(({ exitCode }) => {
    sessions.delete(id)
    send('session:exit', { id, code: exitCode })
  })
  sessions.set(id, {
    type: 'local',
    shell,
    write: (d) => p.write(d),
    resize: (c, r) => { try { p.resize(c, r) } catch {} },
    kill: () => { try { p.kill() } catch {} },
    pause: () => { try { p.pause() } catch {} },
    resume: () => { try { p.resume() } catch {} },
  })
  const title = path.basename(shell).replace(/\.exe$/i, '')
  return { id, title }
})

// ---------- SSH ----------

function verifyHostKey(host, port, fingerprint, callback) {
  const key = String(host).toLowerCase() + ':' + port
  const known = loadConfig().knownHosts[key]
  if (known === fingerprint) return callback(true)
  const changed = !!known
  const detail = changed
    ? mt('The server key changed. This may mean the server was reinstalled or a man-in-the-middle attack is in progress.\n\nSaved: ', 'Ключ сервера изменился. Это может означать переустановку сервера или атаку посредника.\n\nСохранённый: ') + known + mt('\nNew: ', '\nНовый: ') + fingerprint
    : mt('This server is not yet known to MeowShell. Verify the fingerprint with the server administrator.\n\nSHA-256: ', 'Сервер ещё не известен MeowShell. Сверь fingerprint с администратором сервера.\n\nSHA-256: ') + fingerprint
  dialog.showMessageBox(win, {
    type: changed ? 'warning' : 'question',
    title: changed ? mt('SSH: server key changed', 'SSH: ключ сервера изменился') : mt('SSH: new server', 'SSH: новый сервер'),
    message: host + ':' + port,
    detail,
    buttons: changed ? [mt('Reject', 'Отклонить'), mt('Update key and connect', 'Обновить ключ и подключиться')] : [mt('Cancel', 'Отмена'), mt('Trust and connect', 'Доверять и подключиться')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }).then(({ response }) => {
    if (response !== 1) return callback(false)
    const latest = loadConfig()
    latest.knownHosts[key] = fingerprint
    callback(saveConfig(latest))
  }).catch(() => callback(false))
}

handleIpc('session:create-ssh', async (e, cfg = {}) => {
  cfg = resolveSshConfig(cfg)
  const id = String(nextId++)
  return await new Promise((resolve) => {
    const client = new Client()
    let settled = false
    const done = (result) => { if (!settled) { settled = true; resolve(result) } }

    const host = String(cfg.host || '').trim()
    const username = String(cfg.username || '').trim()
    const port = validPort(cfg.port, 22)
    if (!host || !username) return done({ error: 'Укажи хост и пользователя' })
    const connOpts = {
      host,
      port,
      username,
      readyTimeout: 15000,
      keepaliveInterval: 15000,
      hostHash: 'sha256',
      hostVerifier: (fingerprint, callback) => verifyHostKey(host, port, fingerprint, callback),
    }
    if (cfg.keyPath) {
      try {
        connOpts.privateKey = fs.readFileSync(cfg.keyPath)
      } catch (err) {
        return done({ error: 'Не удалось прочитать ключ: ' + err.message })
      }
      if (cfg.passphrase) connOpts.passphrase = cfg.passphrase
    }
    if (cfg.password) connOpts.password = cfg.password

    client.on('ready', () => {
      client.shell(
        { term: 'xterm-256color', cols: cfg.cols || 80, rows: cfg.rows || 24 },
        (err, stream) => {
          if (err) {
            client.end()
            return done({ error: err.message })
          }
          // v0.8.1: потоковый UTF-8 декодер — не рвёт многобайтные символы (кириллицу)
          // на границе сетевых чанков; раньше из-за этого появлялись «??» и ломались TUI
          const { StringDecoder } = require('string_decoder')
          const dec = new StringDecoder('utf8')
          const decErr = new StringDecoder('utf8')
          stream.on('data', (d) => send('session:data', { id, data: dec.write(d) }))
          stream.stderr.on('data', (d) => send('session:data', { id, data: decErr.write(d) }))
          stream.on('close', () => {
            sessions.delete(id)
            try { closeTunnelsFor(id) } catch {}
            try { stopMonitor(id) } catch {}
            try { client.end() } catch {}
            send('session:exit', { id, code: 0 })
          })
          sessions.set(id, {
            type: 'ssh',
            shell: 'posix',
            client,
            write: (d) => stream.write(d),
            resize: (c, r) => { try { stream.setWindow(r, c, 0, 0) } catch {} },
            kill: () => { try { client.end() } catch {} },
            pause: () => { try { stream.pause() } catch {} },
            resume: () => { try { stream.resume() } catch {} },
          })
          done({ id, title: connOpts.username + '@' + connOpts.host })
        }
      )
    })
    client.on('error', (err) => done({ error: err.message }))
    try {
      client.connect(connOpts)
    } catch (err) {
      done({ error: err.message })
    }
  })
})

// ---------- общие операции с сессиями ----------

onIpc('session:write', (e, { id, data }) => {
  const s = sessions.get(id)
  if (s && typeof data === 'string' && data.length <= 10 * 1024 * 1024) s.write(data)
})

onIpc('session:resize', (e, { id, cols, rows }) => {
  const s = sessions.get(id)
  const c = Math.floor(Number(cols))
  const r = Math.floor(Number(rows))
  if (s && c >= 2 && c <= 1000 && r >= 1 && r <= 500) s.resize(c, r)
})

// v0.8.1: flow control — рендер просит источник притормозить/продолжить
onIpc('session:pause', (e, { id }) => {
  const s = sessions.get(id)
  if (s && s.pause) s.pause()
})

onIpc('session:resume', (e, { id }) => {
  const s = sessions.get(id)
  if (s && s.resume) s.resume()
})

onIpc('session:kill', (e, { id }) => {
  const s = sessions.get(id)
  if (s) {
    s.kill()
    sessions.delete(id)
    try { closeTunnelsFor(id) } catch {}
    try { stopMonitor(id) } catch {}
  }
})

// ---------- SFTP ----------

function getSftp(id) {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh') return Promise.reject(new Error('SFTP доступен только для SSH-вкладок'))
  if (!s.sftpPromise) {
    s.sftpPromise = new Promise((res, rej) =>
      s.client.sftp((err, sftp) => (err ? rej(err) : res(sftp)))
    )
  }
  return s.sftpPromise
}

function remotePath(value) {
  const result = String(value || '')
  if (!result || result.length > 4096 || result.includes('\0')) throw new Error('Некорректный удалённый путь')
  return result
}

handleIpc('sftp:list', async (e, { id, path: dir }) => {
  try {
    const sftp = await getSftp(id)
    // превращаем путь в абсолютный (чтобы кнопка «вверх» доходила до корня /)
    const abs = await new Promise((res, rej) =>
      sftp.realpath(dir || '.', (err, p) => (err ? rej(err) : res(p)))
    )
    const list = await new Promise((res, rej) =>
      sftp.readdir(abs, (err, l) => (err ? rej(err) : res(l)))
    )
    const entries = list.map((x) => ({
      name: x.filename,
      isDir: x.attrs.isDirectory(),
      size: x.attrs.size,
      mtime: x.attrs.mtime,
    }))
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return { entries, path: abs }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:download', async (e, { id, remotePath, name }) => {
  try {
    const sftp = await getSftp(id)
    const res = await dialog.showSaveDialog(win, { defaultPath: safeEntryName(name) })
    if (res.canceled || !res.filePath) return { canceled: true }
    await new Promise((r, j) => sftp.fastGet(remotePath, res.filePath, (err) => (err ? j(err) : r())))
    return { ok: true, localPath: res.filePath }
  } catch (err) {
    return { error: err.message }
  }
})

// v2.1: рекурсивное скачивание папки целиком
async function sftpWalkDownload(sftp, remoteDir, localDir, state = { files: 0 }, depth = 0) {
  if (depth > 64) throw new Error('Слишком большая глубина удалённого каталога')
  if (fs.existsSync(localDir) && fs.lstatSync(localDir).isSymbolicLink()) {
    throw new Error('Скачивание через локальную символическую ссылку запрещено')
  }
  fs.mkdirSync(localDir, { recursive: true })
  const list = await new Promise((r, j) => sftp.readdir(remoteDir, (err, l) => (err ? j(err) : r(l))))
  let count = 0
  for (const it of list) {
    const name = safeEntryName(it.filename)
    const rp = remoteDir.replace(/\/+$/, '') + '/' + name
    const lp = resolveLocalChild(localDir, name)
    if (fs.existsSync(lp) && fs.lstatSync(lp).isSymbolicLink()) {
      throw new Error('Локальная символическая ссылка конфликтует с файлом: ' + name)
    }
    const isLink = typeof it.attrs.isSymbolicLink === 'function' && it.attrs.isSymbolicLink()
    if (isLink) continue
    if (it.attrs.isDirectory()) count += await sftpWalkDownload(sftp, rp, lp, state, depth + 1)
    else {
      state.files++
      if (state.files > 100000) throw new Error('В каталоге слишком много файлов для одной операции')
      await new Promise((r, j) => sftp.fastGet(rp, lp, (err) => (err ? j(err) : r())))
      count++
    }
  }
  return count
}
// v2.1.1: надёжный буфер обмена через нативный clipboard Electron
// (navigator.clipboard в рендерере зависит от фокуса окна и может молча падать)
handleIpc('clipboard:read', () => clipboard.readText())
onIpc('clipboard:write', (e, text) => clipboard.writeText(String(text == null ? '' : text)))

handleIpc('sftp:download-dir', async (e, { id, remotePath, name }) => {
  try {
    const sftp = await getSftp(id)
    const res = await dialog.showOpenDialog(win, {
      title: mt('Choose where to download “' + name + '”', 'Куда скачать папку «' + name + '»'),
      buttonLabel: mt('Download here', 'Скачать сюда'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true }
    const target = resolveLocalChild(res.filePaths[0], name)
    const count = await sftpWalkDownload(sftp, remotePath, target)
    return { ok: true, localPath: target, count }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:upload', async (e, { id, remoteDir }) => {
  try {
    const sftp = await getSftp(id)
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (res.canceled || !res.filePaths.length) return { canceled: true }
    const local = res.filePaths[0]
    const remote = String(remoteDir || '.').replace(/\/+$/, '') + '/' + path.basename(local)
    await new Promise((r, j) => sftp.fastPut(local, remote, (err) => (err ? j(err) : r())))
    return { ok: true, remote }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:mkdir', async (e, { id, path: dirPath }) => {
  try {
    const sftp = await getSftp(id)
    await new Promise((r, j) => sftp.mkdir(dirPath, (err) => (err ? j(err) : r())))
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

// Загрузка конкретных локальных файлов (drag&drop) с прогрессом
handleIpc('files:grant-upload', (e, paths) => {
  const grants = []
  for (const value of Array.isArray(paths) ? paths.slice(0, 100) : []) {
    try {
      const filePath = path.resolve(String(value || ''))
      if (!path.isAbsolute(filePath) || !fs.statSync(filePath).isFile()) continue
      const token = crypto.randomBytes(24).toString('hex')
      uploadGrants.set(token, { filePath, expiresAt: Date.now() + 2 * 60 * 1000 })
      grants.push(token)
    } catch {}
  }
  return grants
})

handleIpc('sftp:upload-grants', async (e, { id, remoteDir, grants }) => {
  try {
    const sftp = await getSftp(id)
    const remotes = []
    const paths = []
    for (const token of Array.isArray(grants) ? grants.slice(0, 100) : []) {
      const grant = uploadGrants.get(String(token || ''))
      uploadGrants.delete(String(token || ''))
      if (!grant || grant.expiresAt < Date.now()) throw new Error('Разрешение на загрузку файла истекло')
      paths.push(grant.filePath)
    }
    for (const local of paths) {
      const stat = fs.statSync(local)
      if (!stat.isFile()) throw new Error('Загрузка папок перетаскиванием пока не поддерживается')
      const name = path.basename(local)
      const remote = String(remoteDir || '.').replace(/\/+$/, '') + '/' + name
      await new Promise((r, j) =>
        sftp.fastPut(
          local,
          remote,
          { step: (done, chunk, total) => send('sftp:progress', { id, name, done, total }) },
          (err) => (err ? j(err) : r())
        )
      )
      send('sftp:progress', { id, name, done: 1, total: 1 })
      remotes.push(remote)
    }
    return { ok: true, remotes }
  } catch (err) {
    return { error: err.message }
  }
})

// ---------- Ctrl+V: скриншот или файл из буфера обмена ----------
// Локальная вкладка: сохраняем скриншот во временную папку и вставляем путь.
// SSH-вкладка: загружаем файл в закрытый каталог ~/.meowshell и вставляем серверный путь.

handleIpc('session:paste-media', async (e, { id }) => {
  const s = sessions.get(id)
  if (!s) return { handled: false }
  try {
    let localPath = null
    let temporaryFile = false

    // 1) файл, скопированный в Проводнике (Ctrl+C по файлу)
    try {
      const raw = clipboard.readBuffer('FileNameW')
      if (raw && raw.length) {
        const p = raw.toString('ucs2').replace(/\0+$/g, '').trim()
        if (p && fs.existsSync(p) && fs.statSync(p).isFile()) localPath = p
      }
    } catch {}

    // 2) картинка в буфере (скриншот через Win+Shift+S и т.п.)
    if (!localPath) {
      const img = clipboard.readImage()
      if (!img.isEmpty()) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meowshell-media-'))
        localPath = path.join(dir, 'screenshot.png')
        fs.writeFileSync(localPath, img.toPNG())
        temporaryFile = true
      }
    }

    if (!localPath) return { handled: false }

    if (s.type === 'local') {
      s.write(quotePathForShell(localPath, s.shell))
      return { handled: true, path: localPath }
    }

    // SSH: отдельная закрытая папка в домашнем каталоге и случайное имя.
    const sftp = await getSftp(id)
    const home = await new Promise((r, j) => sftp.realpath('.', (err, p) => (err ? j(err) : r(p))))
    const cache = home.replace(/\/+$/, '') + '/.meowshell'
    await new Promise((r) => sftp.mkdir(cache, { mode: 0o700 }, () => r()))
    await new Promise((r) => sftp.chmod(cache, 0o700, () => r()))
    const ext = path.extname(localPath).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12)
    const remote = cache + '/paste-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext
    try {
      await new Promise((r, j) => sftp.fastPut(localPath, remote, (err) => (err ? j(err) : r())))
    } finally {
      if (temporaryFile) {
        try { fs.unlinkSync(localPath) } catch {}
        try { fs.rmdirSync(path.dirname(localPath)) } catch {}
      }
    }
    s.write(quotePosix(remote))
    return { handled: true, path: remote }
  } catch (err) {
    return { handled: false, error: err.message }
  }
})

// ---------- конфиг: IPC ----------

handleIpc('config:get', () => cfgView(loadConfig()))

const pendingConfigImports = new Map()

handleIpc('config:export', async () => {
  try {
    const result = await dialog.showSaveDialog(win, {
      title: mt('Export MeowShell configuration', 'Экспорт конфигурации MeowShell'),
      defaultPath: 'meowshell-settings-' + new Date().toISOString().slice(0, 10) + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    fs.writeFileSync(result.filePath, JSON.stringify(exportableConfig(loadConfig()), null, 2), { mode: 0o600 })
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('config:import-preview', async () => {
  try {
    const result = await dialog.showOpenDialog(win, {
      title: mt('Import MeowShell configuration', 'Импорт конфигурации MeowShell'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    const stat = fs.statSync(result.filePaths[0])
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Configuration file is too large')
    const imported = importedConfig(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')))
    const token = crypto.randomBytes(24).toString('hex')
    pendingConfigImports.set(token, { imported, expiresAt: Date.now() + 5 * 60 * 1000 })
    return {
      token,
      connections: imported.connections.length,
      settings: Object.keys(imported.settings).length,
      containsSecrets: false,
    }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('config:import-apply', (e, payload) => {
  try {
    const token = payload && String(payload.token || '')
    const pending = pendingConfigImports.get(token)
    pendingConfigImports.delete(token)
    if (!pending || pending.expiresAt < Date.now()) throw new Error('Import confirmation expired')
    const current = loadConfig()
    backupConfig('before-import')
    if (payload.mode === 'replace') {
      current.settings = pending.imported.settings
      current.connections = pending.imported.connections
    } else {
      current.settings = Object.assign({}, current.settings, pending.imported.settings)
      const byEndpoint = new Set(current.connections.map((item) => item.username + '@' + item.host + ':' + item.port))
      for (const connection of pending.imported.connections) {
        const endpoint = connection.username + '@' + connection.host + ':' + connection.port
        if (!byEndpoint.has(endpoint)) {
          current.connections.push(connection)
          byEndpoint.add(endpoint)
        }
      }
    }
    if (!saveConfig(current)) throw new Error('Could not save imported configuration')
    return { ok: true, view: cfgView(current) }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('config:reset', (e, mode) => {
  try {
    const cfg = loadConfig()
    const backupPath = backupConfig('before-reset')
    if (mode === 'all') {
      cfg.connections = []
      cfg.settings = {}
      cfg.knownHosts = {}
    } else {
      cfg.settings = {}
    }
    if (!saveConfig(cfg)) throw new Error('Could not reset configuration')
    return { ok: true, backupPath, view: cfgView(cfg) }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('app:diagnostics', () => ({
  appVersion: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
  osRelease: os.release(),
  packaged: app.isPackaged,
  safeMode: isSafeGpuMode(),
  localPty: !!pty,
  telemetry: false,
  paths: {
    config: configPath(),
    logs: errorLogPath,
    crashDumps: app.getPath('crashDumps'),
    backups: path.join(path.dirname(configPath()), 'backups'),
  },
}))

handleIpc('app:open-path', async (e, kind) => {
  const allowed = {
    config: path.dirname(configPath()),
    logs: errorLogPath,
    crashDumps: app.getPath('crashDumps'),
    backups: path.join(path.dirname(configPath()), 'backups'),
  }
  const target = allowed[String(kind || '')]
  if (!target) return { error: 'Unknown diagnostics path' }
  if (!fs.existsSync(target)) {
    if (kind === 'logs') fs.writeFileSync(target, '', { mode: 0o600 })
    else fs.mkdirSync(target, { recursive: true })
  }
  const error = await shell.openPath(target)
  return error ? { error } : { ok: true }
})

handleIpc('app:clear-safe-mode', () => {
  try {
    const marker = gpuMarkerPath()
    if (marker && fs.existsSync(marker)) fs.unlinkSync(marker)
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

onIpc('app:restart', () => {
  app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--meowshell-safe-mode') })
  app.exit(0)
})

onIpc('app:smoke-ready', () => {
  if (ciSmokeTest) setTimeout(() => app.exit(0), 500)
})

handleIpc('config:save-connection', (e, conn) => {
  try {
    if (!conn || typeof conn !== 'object') return { error: 'Некорректные данные подключения' }
    const cfg = loadConfig()
    const current = conn.id ? cfg.connections.find((item) => item.id === conn.id) : null
    const clean = {
      id: typeof conn.id === 'string' ? conn.id : undefined,
      name: String(conn.name || '').trim().slice(0, 200),
      host: String(conn.host || '').trim().slice(0, 253),
      port: validPort(conn.port, 22),
      username: String(conn.username || '').trim().slice(0, 128),
      keyPath: String(conn.keyPath || '').trim(),
      tunnels: Array.isArray(conn.tunnels) ? conn.tunnels.slice(0, 100) : (current && current.tunnels) || [],
      password: current ? current.password || '' : '',
      passphrase: current ? current.passphrase || '' : '',
    }
    if (!clean.host || !clean.username) return { error: 'Укажи хост и пользователя' }
    if (conn.clearPassword) clean.password = ''
    else if (typeof conn.password === 'string' && conn.password) clean.password = encSecret(conn.password)
    if (conn.clearPassphrase) clean.passphrase = ''
    else if (typeof conn.passphrase === 'string' && conn.passphrase) clean.passphrase = encSecret(conn.passphrase)
    if (clean.id) {
      const i = cfg.connections.findIndex((c) => c.id === clean.id)
      if (i >= 0) cfg.connections[i] = clean
      else cfg.connections.push(clean)
    } else {
      clean.id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
      cfg.connections.push(clean)
    }
    if (!saveConfig(cfg)) return { error: 'Не удалось сохранить конфигурацию' }
    return cfgView(cfg)
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('config:delete-connection', (e, connId) => {
  const cfg = loadConfig()
  cfg.connections = (cfg.connections || []).filter((c) => c.id !== String(connId || ''))
  if (!saveConfig(cfg)) return { error: 'Не удалось сохранить конфигурацию' }
  return cfgView(cfg)
})

// Импорт SSH-профилей из Tabby (config.yaml). Пароли Tabby хранит в системном
// хранилище Windows, поэтому импортируются только адреса/логины/ключи.
handleIpc('config:import-tabby', async () => {
  try {
    let yaml
    try {
      yaml = require('js-yaml')
    } catch {
      return { error: 'Модуль js-yaml не установлен — выполни npm install и перезапусти приложение' }
    }
    const res = await dialog.showOpenDialog(win, {
      title: mt('Choose Tabby config.yaml', 'Выбери config.yaml из Tabby'),
      defaultPath: path.join(process.env.APPDATA || os.homedir(), 'tabby'),
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths.length) return { canceled: true }
    const stat = fs.statSync(res.filePaths[0])
    if (stat.size > 5 * 1024 * 1024) return { error: 'Файл конфигурации слишком большой' }
    const doc = yaml.load(fs.readFileSync(res.filePaths[0], 'utf8'))
    const profiles = Array.isArray(doc && doc.profiles) ? doc.profiles : []
    const cfg = loadConfig()
    cfg.connections = cfg.connections || []
    let added = 0
    for (const p of profiles) {
      if (!p || p.type !== 'ssh' || !p.options || !p.options.host) continue
      const user = p.options.user || 'root'
      const port = validPort(p.options.port, 22)
      const exists = cfg.connections.some(
        (c) => c.host === p.options.host && c.username === user && Number(c.port || 22) === port
      )
      if (exists) continue
      let keyPath = ''
      if (Array.isArray(p.options.privateKeys) && p.options.privateKeys[0]) {
        keyPath = String(p.options.privateKeys[0]).replace(/^file:\/\//, '')
      }
      cfg.connections.push({
        id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
        name: String(p.name || user + '@' + p.options.host).trim().slice(0, 200),
        host: String(p.options.host).trim().slice(0, 253),
        port,
        username: String(user).trim().slice(0, 128),
        keyPath: keyPath.slice(0, 4096),
        password: '',
        passphrase: '',
      })
      added++
    }
    if (!saveConfig(cfg)) return { error: 'Не удалось сохранить импортированные подключения' }
    return { ok: true, added, view: cfgView(cfg) }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('config:save-settings', (e, settings) => {
  const cfg = loadConfig()
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { error: 'Некорректные настройки' }
  const incoming = normalizeConfig({ settings: JSON.parse(JSON.stringify(settings)) }).settings
  cfg.settings = Object.assign({}, cfg.settings, incoming)
  if (!saveConfig(cfg)) return { error: 'Не удалось сохранить настройки' }
  return cfgView(cfg)
})

handleIpc('dialog:pick-file', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'] })
  if (res.canceled || !res.filePaths.length) return null
  const filePath = path.resolve(res.filePaths[0])
  selectedLocalFiles.add(filePath)
  return filePath
})

handleIpc('app:local-resource', (e, payload) => {
  try {
    const filePath = path.resolve(String(payload && payload.path || ''))
    const type = payload && payload.type
    const allowed = type === 'image' ? /\.(?:png|jpe?g|gif|webp|bmp)$/i : /$a/
    if (!selectedLocalFiles.has(filePath) || !allowed.test(filePath) || !fs.statSync(filePath).isFile()) return null
    return registerLocalResource(filePath)
  } catch {
    return null
  }
})

// ---------- v0.7: SFTP 2.0 ----------

async function sftpRmrf(sftp, target, state = { entries: 0 }, depth = 0) {
  if (depth > 64) throw new Error('Слишком глубокая структура каталогов')
  state.entries++
  if (state.entries > 100000) throw new Error('Слишком много файлов для одной операции')
  const st = await new Promise((res, rej) => sftp.lstat(target, (err, s) => (err ? rej(err) : res(s))))
  if (st.isDirectory()) {
    const list = await new Promise((res, rej) => sftp.readdir(target, (err, l) => (err ? rej(err) : res(l))))
    for (const item of list) {
      const name = String(item && item.filename || '')
      if (!name || name === '.' || name === '..' || /[\/\0]/.test(name)) throw new Error('Сервер вернул небезопасное имя файла')
      await sftpRmrf(sftp, target.replace(/\/+$/, '') + '/' + name, state, depth + 1)
    }
    await new Promise((res, rej) => sftp.rmdir(target, (err) => (err ? rej(err) : res())))
  } else {
    await new Promise((res, rej) => sftp.unlink(target, (err) => (err ? rej(err) : res())))
  }
}

handleIpc('sftp:rename', async (e, { id, from, to }) => {
  try {
    const sftp = await getSftp(id)
    await new Promise((res, rej) => sftp.rename(from, to, (err) => (err ? rej(err) : res())))
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:chmod', async (e, { id, path: p, mode }) => {
  try {
    if (!/^[0-7]{3,4}$/.test(String(mode))) return { error: 'Неверный режим chmod' }
    const sftp = await getSftp(id)
    await new Promise((res, rej) => sftp.chmod(p, parseInt(String(mode), 8), (err) => (err ? rej(err) : res())))
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:delete', async (e, { id, path: p }) => {
  try {
    p = remotePath(p)
    if (p === '/' || p === '.' || p === '..') return { error: 'Корневой каталог удалять нельзя' }
    const sftp = await getSftp(id)
    await sftpRmrf(sftp, p)
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:read-file', async (e, { id, path: p }) => {
  try {
    const sftp = await getSftp(id)
    const st = await new Promise((res, rej) => sftp.stat(p, (err, s) => (err ? rej(err) : res(s))))
    if (st.size > 2 * 1024 * 1024) return { error: 'Файл слишком большой для редактора (макс. 2 МБ)' }
    const buf = await new Promise((res, rej) => sftp.readFile(p, (err, b) => (err ? rej(err) : res(b))))
    return { content: buf.toString('utf8') }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:write-file', async (e, { id, path: p, content }) => {
  try {
    content = String(content == null ? '' : content)
    if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) return { error: 'Файл слишком большой для редактора (макс. 2 МБ)' }
    const sftp = await getSftp(id)
    await new Promise((res, rej) => sftp.writeFile(p, content, 'utf8', (err) => (err ? rej(err) : res())))
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

// ---------- v0.9: quake-режим, SSH-туннели, мониторинг, ключи ----------
const netV9 = require('net')

// --- Quake-режим: глобальный хоткей показать/спрятать окно ---
let quakeAcc = null
let quakePrevBounds = null
let quakeSettingBounds = false // true, пока размер меняем мы сами (а не пользователь)

function registerQuake(s) {
  try {
    if (quakeAcc) { globalShortcut.unregister(quakeAcc); quakeAcc = null }
  } catch {}
  // если пользователь сам растянул/развернул окно — забываем сохранённые quake-границы,
  // чтобы хоткей не «отбрасывал» окно назад
  if (win && !win.__quakeWatch) {
    win.__quakeWatch = 1
    win.on('resize', () => { if (!quakeSettingBounds) quakePrevBounds = null })
  }
  if (!s || s.quakeEnabled !== true) return
  const acc = s.quakeHotkey || 'CommandOrControl+`'
  try {
    if (globalShortcut.register(acc, () => toggleQuake(s))) quakeAcc = acc
  } catch {}
}

function toggleQuake(s) {
  if (!win) return
  if (win.isVisible() && win.isFocused()) {
    if (quakePrevBounds) {
      quakeSettingBounds = true
      try { win.setBounds(quakePrevBounds) } catch {}
      quakePrevBounds = null
      setTimeout(() => { quakeSettingBounds = false }, 400)
    }
    win.hide()
    return
  }
  // окно уже на экране, просто не в фокусе — фокусируем и НЕ трогаем размер
  if (win.isVisible()) {
    win.focus()
    return
  }
  if (s.quakeDock !== false) {
    try {
      const wa = screen.getPrimaryDisplay().workArea
      if (!quakePrevBounds) quakePrevBounds = win.getBounds()
      quakeSettingBounds = true
      const heightPercent = Math.min(100, Math.max(20, Number(s.quakeHeight) || 50))
      win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: Math.round(wa.height * (heightPercent / 100)) })
      setTimeout(() => { quakeSettingBounds = false }, 400)
    } catch {}
  }
  win.show()
  win.focus()
}

onIpc('quake:refresh', (e, s) => registerQuake(s || {}))
app.on('will-quit', () => { try { globalShortcut.unregisterAll() } catch {} })

// --- SSH-туннели (локальный порт → адрес, видимый с сервера) ---
const tunnels = new Map() // ключ: sessId:localPort

handleIpc('tunnel:start', (e, { id, localPort, remoteHost, remotePort }) => {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh' || !s.client) return { error: 'нет активной SSH-сессии' }
  const lp = validPort(localPort)
  const rp = validPort(remotePort)
  if (!lp || !rp) return { error: 'неверный порт' }
  remoteHost = String(remoteHost || '127.0.0.1').trim()
  if (!remoteHost || remoteHost.length > 253 || remoteHost.includes('\0')) return { error: 'неверный адрес назначения' }
  const key = id + ':' + lp
  if (tunnels.has(key)) return { error: 'порт ' + lp + ' уже проброшен' }
  return new Promise((resolve) => {
    let resolved = false
    const server = netV9.createServer((socket) => {
      s.client.forwardOut('127.0.0.1', socket.remotePort || 0, remoteHost || '127.0.0.1', rp, (err, stream) => {
        if (err) { try { socket.destroy() } catch {} ; return }
        socket.pipe(stream).pipe(socket)
        stream.on('error', () => { try { socket.destroy() } catch {} })
        socket.on('error', () => { try { stream.end() } catch {} })
      })
    })
    server.on('error', (err) => {
      tunnels.delete(key)
      if (!resolved) {
        resolved = true
        resolve({ error: err.code === 'EADDRINUSE' ? 'порт ' + lp + ' уже занят на этом компьютере' : err.message })
      }
    })
    server.listen(lp, '127.0.0.1', () => {
      if (!resolved) { resolved = true; resolve({ ok: true }) }
    })
    tunnels.set(key, { server, sessId: id })
  })
})

handleIpc('tunnel:stop', (e, { id, localPort }) => {
  const key = id + ':' + parseInt(localPort, 10)
  const t = tunnels.get(key)
  if (t) {
    try { t.server.close() } catch {}
    tunnels.delete(key)
  }
  return { ok: true }
})

function closeTunnelsFor(id) {
  for (const [k, t] of [...tunnels]) {
    if (t.sessId === id) {
      try { t.server.close() } catch {}
      tunnels.delete(k)
    }
  }
}

// --- мониторинг сервера (CPU/RAM/диск/аптайм по SSH) ---
const monitors = new Map()

function stopMonitor(id) {
  const m = monitors.get(id)
  if (m) { clearInterval(m.timer); monitors.delete(id) }
}

onIpc('monitor:stop', (e, { id }) => stopMonitor(id))

onIpc('monitor:start', (e, { id, interval }) => {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh' || !s.client) return
  stopMonitor(id)
  const state = {}
  const cmd = "cat /proc/stat 2>/dev/null | head -1; echo @@; free -b 2>/dev/null | grep -i '^mem'; echo @@; df -B1 -P / 2>/dev/null | tail -1; echo @@; cat /proc/uptime 2>/dev/null"
  const tick = () => {
    if (!sessions.has(id)) return stopMonitor(id)
    if (state.busy) return
    state.busy = true
    try {
      s.client.exec(cmd, (err, stream) => {
        if (err) { state.busy = false; return }
        let out = ''
        stream.on('data', (d) => { out += d.toString('utf8') })
        stream.stderr.on('data', () => {})
        stream.on('error', () => { state.busy = false })
        stream.on('close', () => {
          state.busy = false
          const p = out.split('@@').map((x) => x.trim())
          const res = { id }
          const cpu = (p[0] || '').split(/\s+/).slice(1).map(Number)
          if (cpu.length >= 4) {
            const idle = cpu[3] + (cpu[4] || 0)
            const total = cpu.reduce((a, b) => a + (b || 0), 0)
            if (state.last) {
              const dt = total - state.last.total
              const di = idle - state.last.idle
              if (dt > 0) res.cpu = Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)))
            }
            state.last = { idle, total }
          }
          const mem = (p[1] || '').split(/\s+/)
          if (mem.length >= 3) { res.memTotal = +mem[1]; res.memUsed = +mem[2] }
          const disk = (p[2] || '').split(/\s+/)
          if (disk.length >= 4) { res.diskTotal = +disk[1]; res.diskUsed = +disk[2] }
          const up = parseFloat(p[3])
          if (isFinite(up)) res.uptime = up
          send('monitor:data', res)
        })
      })
    } catch { state.busy = false }
  }
  tick()
  const delay = Math.min(60000, Math.max(2000, Number(interval) || 3000))
  monitors.set(id, { timer: setInterval(tick, delay) })
})

// --- генерация SSH-ключей и установка на сервер ---
handleIpc('ssh:keygen', async (e, { type, comment, passphrase }) => {
  let utils
  try { utils = require('ssh2').utils } catch (err) { return { error: err.message } }
  if (!utils || typeof utils.generateKeyPairSync !== 'function') return { error: 'эта версия ssh2 не умеет генерировать ключи' }
  const kt = type === 'rsa' ? 'rsa' : 'ed25519'
  const opts = { comment: String(comment || 'meowshell').replace(/[\r\n]/g, ' ').slice(0, 200) }
  if (kt === 'rsa') opts.bits = 4096
  if (passphrase) { opts.passphrase = passphrase; opts.cipher = 'aes256-cbc' }
  let pair
  try { pair = utils.generateKeyPairSync(kt, opts) } catch (err) { return { error: err.message } }
  const def = path.join(os.homedir(), '.ssh', 'id_' + kt)
  const r = await dialog.showSaveDialog(win, { title: mt('Save the private key', 'Куда сохранить приватный ключ'), defaultPath: def })
  if (r.canceled || !r.filePath) return { canceled: true }
  try {
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true })
    fs.writeFileSync(r.filePath, pair.private, { mode: 0o600 })
    fs.writeFileSync(r.filePath + '.pub', pair.public)
  } catch (err) { return { error: err.message } }
  return { privatePath: r.filePath, publicPath: r.filePath + '.pub', publicKey: pair.public }
})

handleIpc('ssh:install-key', (e, { id, pubPath, publicKey }) => {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh' || !s.client) return { error: 'нет активной SSH-сессии' }
  let pk = String(publicKey || '').trim()
  if (!pk && pubPath) {
    try { pk = fs.readFileSync(pubPath, 'utf8').trim() } catch (err) { return { error: err.message } }
  }
  if (pk.length > 16384 || /[\r\n]/.test(pk)) return { error: 'публичный ключ должен занимать одну строку' }
  if (!/^(ssh-(rsa|ed25519)|ecdsa-)/.test(pk)) return { error: 'файл не похож на публичный ключ (*.pub)' }
  return new Promise((resolve) => {
    s.client.exec('mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys', (err, stream) => {
      if (err) return resolve({ error: err.message })
      let errOut = ''
      stream.stderr.on('data', (d) => { errOut += d })
      stream.on('close', (code) => resolve(code === 0 ? { ok: true } : { error: errOut.trim() || ('код ' + code) }))
      stream.end(pk + '\n')
    })
  })
})

// ==================== v1.0: пользовательские шрифты из папки fonts/ ====================
handleIpc('fonts:list', () => {
  const dirs = []
  try { dirs.push(path.join(app.getAppPath(), 'fonts')) } catch {}
  try { dirs.push(path.join(path.dirname(app.getPath('exe')), 'fonts')) } catch {}
  try { if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'fonts')) } catch {}
  const out = []
  const seen = new Set()
  for (const d of dirs) {
    let files = []
    try { files = fs.readdirSync(d) } catch { continue }
    for (const f of files) {
      if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue
      const base = f.replace(/\.[^.]+$/, '')
      if (seen.has(base)) continue
      seen.add(base)
      out.push({ name: base, url: registerLocalResource(path.join(d, f)) })
    }
  }
  return out
})
