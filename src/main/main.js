const { app, BrowserWindow, ipcMain, dialog, clipboard, safeStorage, shell, session, globalShortcut, screen, crashReporter, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { pathToFileURL } = require('url')
const {
  MAX_CONFIG_BYTES,
  MAX_EDITOR_BYTES,
  destroyResources,
  formatSshCommand,
  isDangerousRemoteTarget,
  normalizeConfig,
  normalizeRemotePath,
  quotePathForShell,
  quotePosix,
  resolveLocalChild,
  resolveSshConnection,
  safeEntryName,
  safeRemoteEntryName,
  sanitizeConnection,
  validPort,
  validSshEndpoint,
} = require('./utils')
const {
  atomicRemoteWrite,
  call: callSftp,
  ensurePrivateDirectory,
  fastGetAtomic,
  fastPutAtomic,
  fileVersion,
  getRetryableSftp,
  lstatMaybe,
  readDirectoryLimited,
  readFileLimited,
} = require('./sftp-utils')

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

// ---------- защита от «молчаливых» падений ----------
// Если в главном процессе что-то падает, показываем окно с ошибкой
// и пишем лог в приватный каталог данных приложения, чтобы можно было разобраться.
const errorLogPath = path.join(app.getPath('userData'), 'logs', 'meowshell-error.log')
const legacyErrorLogPath = path.join(os.tmpdir(), 'meowshell-error.log')
try {
  fs.mkdirSync(path.dirname(errorLogPath), { recursive: true })
  if (fs.statSync(errorLogPath).size > 5 * 1024 * 1024) {
    const previous = errorLogPath + '.1'
    try { fs.unlinkSync(previous) } catch {}
    fs.renameSync(errorLogPath, previous)
  }
  try { fs.chmodSync(errorLogPath, 0o600) } catch {}
} catch {}

function reportFatal(err) {
  const text = (err && err.stack) || String(err)
  try {
    fs.mkdirSync(path.dirname(errorLogPath), { recursive: true })
    fs.appendFileSync(
      errorLogPath,
      new Date().toISOString() + '\n' + text + '\n\n',
      { encoding: 'utf8', mode: 0o600 }
    )
  } catch {}
  try { dialog.showErrorBox(mt('MeowShell — Error', 'MeowShell — ошибка'), text) } catch {}
}
process.on('uncaughtException', reportFatal)
process.on('unhandledRejection', reportFatal)

// v2.0.2: диагностика «молчаливого» закрытия
function logLine(msg) {
  try {
    fs.mkdirSync(path.dirname(errorLogPath), { recursive: true })
    fs.appendFileSync(
      errorLogPath,
      new Date().toISOString() + ' ' + msg + '\n',
      { encoding: 'utf8', mode: 0o600 }
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
let suppressShutdownLog = false
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
  reportFatal(new Error('Окно аварийно завершилось даже в безопасном режиме: ' + reason + '\nЛог: ' + errorLogPath + '\nДампы: ' + app.getPath('crashDumps')))
})
app.on('child-process-gone', (event, details) => {
  if (!details) return
  logLine('[crash] служебный процесс упал: ' + details.type + ' / ' + details.reason)
  if (details.type === 'GPU' && (details.reason === 'crashed' || details.reason === 'launch-failed')) {
    enableSafeGpuMode('GPU: ' + details.reason)
  }
})
app.on('will-quit', () => { if (!suppressShutdownLog) logLine('[quit] приложение завершилось') })

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
const pendingSshClients = new Map()
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

let configRecovery = null

function readConfigDocument(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error('Конфигурация не является обычным JSON-файлом допустимого размера')
  }
  return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')))
}

function latestConfigBackup() {
  const directory = path.join(path.dirname(configPath()), 'backups')
  let candidates = []
  try {
    candidates = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^meowshell-.*\.json$/i.test(entry.name))
      .map((entry) => {
        const file = path.join(directory, entry.name)
        return { file, mtime: fs.lstatSync(file).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {}
  for (const candidate of candidates.slice(0, 100)) {
    try { return { config: readConfigDocument(candidate.file), file: candidate.file } } catch {}
  }
  return null
}

function quarantineBrokenConfig(file, error) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const target = path.join(path.dirname(file), 'meowshell-config.corrupt-' + stamp + '-' + crypto.randomBytes(3).toString('hex') + '.json')
  try {
    fs.renameSync(file, target)
    logLine('[config] повреждённый файл перемещён: ' + target + ' | ' + error.message)
    return target
  } catch (renameError) {
    logLine('[config] не удалось изолировать повреждённый файл: ' + renameError.message)
    return null
  }
}

function migrateLegacySecrets(cfg, allowSave = true) {
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
  const stillPlaintext = cfg.connections.some((connection) =>
    ['password', 'passphrase'].some((field) => {
      const value = connection[field]
      return typeof value === 'string' && value && !value.startsWith('enc:')
    })
  )
  // Никогда не создаём новую копию конфига с открытым секретом. Если системное
  // шифрование временно недоступно, старый файл остаётся только для чтения.
  if (changed && allowSave && !stillPlaintext) saveConfig(cfg)
  return cfg
}

function loadConfig() {
  const current = configPath()
  if (fs.existsSync(current)) {
    try {
      return migrateLegacySecrets(readConfigDocument(current))
    } catch (err) {
      const quarantined = quarantineBrokenConfig(current, err)
      const recovered = latestConfigBackup()
      if (recovered) {
        const recoveredConfig = migrateLegacySecrets(recovered.config, false)
        const restored = !!quarantined && saveConfig(recoveredConfig)
        configRecovery = { type: 'backup', source: recovered.file, quarantined, restored }
        return recoveredConfig
      }
      const empty = normalizeConfig(null)
      const restored = !!quarantined && saveConfig(empty)
      configRecovery = { type: 'empty', quarantined, restored }
      return empty
    }
  }
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
        const cfg = migrateLegacySecrets(
          normalizeConfig(JSON.parse(fs.readFileSync(oldFile, 'utf8'))),
          false
        )
        const hasPlaintext = cfg.connections.some((connection) =>
          [connection.password, connection.passphrase].some((value) =>
            typeof value === 'string' && value && !value.startsWith('enc:')
          )
        )
        if (!hasPlaintext) saveConfig(cfg)
        return cfg
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
    const normalized = normalizeConfig(cfg)
    if (normalized.connections.some((connection) =>
      [connection.password, connection.passphrase].some((value) =>
        typeof value === 'string' && value && !value.startsWith('enc:')
      ))) {
      throw new Error('Конфигурация содержит незашифрованный секрет; сохранение отменено')
    }
    const document = JSON.stringify(normalized, null, 2)
    if (Buffer.byteLength(document, 'utf8') > MAX_CONFIG_BYTES) {
      throw new Error('Конфигурация превышает допустимый размер')
    }
    replaceLocalFile(file, document, 0o600)
    return true
  } catch (err) {
    console.error('Не удалось сохранить конфиг:', err.message)
    return false
  }
}

function replaceLocalFile(file, data, mode = 0o600) {
  const target = path.resolve(file)
  const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex')
  const backup = target + '.replace-' + crypto.randomBytes(4).toString('hex')
  let hadTarget = false
  let installed = false
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.writeFileSync(tmp, data, { mode, flag: 'wx' })
    try {
      fs.renameSync(tmp, target)
      installed = true
    } catch (renameError) {
      // libuv обычно заменяет файл атомарно и на Windows. Fallback нужен для
      // отдельных файловых систем, которые возвращают EEXIST/EPERM.
      if (process.platform !== 'win32' || !fs.existsSync(target)) throw renameError
      fs.renameSync(target, backup)
      hadTarget = true
      fs.renameSync(tmp, target)
      installed = true
    }
    try { fs.chmodSync(target, mode) } catch {}
    if (hadTarget) fs.unlinkSync(backup)
  } catch (err) {
    if (installed) { try { fs.unlinkSync(target) } catch {} }
    if (hadTarget) { try { fs.renameSync(backup, target) } catch {} }
    throw err
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

function backupConfig(label = 'backup') {
  const source = configPath()
  if (!fs.existsSync(source)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const suffix = crypto.randomBytes(3).toString('hex')
  const target = path.join(path.dirname(source), 'backups', 'meowshell-' + label + '-' + stamp + '-' + suffix + '.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  try { fs.chmodSync(target, 0o600) } catch {}
  return target
}

function exportableConfig(cfg) {
  const normalized = normalizeConfig(cfg)
  const settings = Object.assign({}, normalized.settings, {
    // Snippets can contain passwords and tokens embedded by the user.
    snippets: [],
  })
  for (const key of [
    'bgImage', 'lastTabs', 'onboardingComplete', 'shell', 'quakeEnabled',
    'quakeHotkey', 'restoreTabs',
  ]) delete settings[key]
  return {
    format: 'meowshell-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    containsSecrets: false,
    settings,
    connections: normalized.connections.map((connection) => ({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authMode: connection.authMode,
      tunnels: connection.tunnels,
    })),
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
    authMode: connection.authMode === 'key' ? 'key' : 'password',
    keyPath: '',
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
      if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' &&
          safeStorage.getSelectedStorageBackend() === 'basic_text') {
        throw new Error('системное хранилище Linux использует небезопасный backend basic_text')
      }
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
    smokeTest: ciSmokeTest,
    platform: process.platform,
    backgroundResourceUrl,
    securityWarning: (cfg.connections || []).some((c) =>
      [c.password, c.passphrase].some((value) => typeof value === 'string' && value && !value.startsWith('enc:'))
    ) ? 'В старой конфигурации остались незашифрованные секреты: системное шифрование сейчас недоступно.' : '',
    configNotice: configRecovery
      ? (configRecovery.type === 'backup'
          ? (configRecovery.restored
              ? mt('The damaged configuration was isolated and the latest valid backup was restored.', 'Повреждённая конфигурация изолирована, восстановлена последняя исправная резервная копия.')
              : mt('The current configuration could not be replaced. A valid backup was loaded for this session; check file permissions before saving changes.', 'Текущую конфигурацию не удалось заменить. Исправная копия загружена только на этот сеанс; проверь права на файл до сохранения изменений.'))
          : (configRecovery.restored
              ? mt('The damaged configuration was isolated, but no valid backup was found. MeowShell started with empty settings.', 'Повреждённая конфигурация изолирована, но исправной резервной копии нет. MeowShell запущен с пустыми настройками.')
              : mt('The configuration could not be read or isolated. MeowShell is using temporary empty settings; check file permissions.', 'Конфигурацию не удалось прочитать или изолировать. MeowShell использует временные пустые настройки; проверь права на файл.')))
      : '',
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
  return resolveSshConnection(source, saved, decSecret)
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const rendererUrl = 'app://meowshell/src/renderer/index.html'
const localResources = new Map()
const selectedLocalFiles = new Set()
const uploadGrants = new Map()
const temporaryMediaBySession = new Map()

function removeTemporaryMediaDirectory(directory) {
  try {
    const tempRoot = path.resolve(os.tmpdir())
    const target = path.resolve(String(directory || ''))
    const relative = path.relative(tempRoot, target)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false
    if (!path.basename(target).startsWith('meowshell-media-')) return false
    const stat = fs.lstatSync(target)
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return false
    if (stat.isSymbolicLink()) fs.unlinkSync(target)
    else if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true })
    else return false
    return true
  } catch {
    return false
  }
}

function rememberTemporaryMedia(id, directory) {
  if (!temporaryMediaBySession.has(id)) temporaryMediaBySession.set(id, new Set())
  temporaryMediaBySession.get(id).add(directory)
}

function cleanupTemporaryMedia(id) {
  const directories = temporaryMediaBySession.get(id)
  temporaryMediaBySession.delete(id)
  for (const directory of directories || []) removeTemporaryMediaDirectory(directory)
}

function pruneExpired(map) {
  const now = Date.now()
  for (const [key, value] of map) if (!value || value.expiresAt < now) map.delete(key)
}

function cleanupStaleTemporaryMedia(maxAge = 24 * 60 * 60 * 1000) {
  let entries = []
  try { entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.name.startsWith('meowshell-media-')) continue
    const target = path.join(os.tmpdir(), entry.name)
    try {
      const stat = fs.lstatSync(target)
      if (maxAge === 0 || Date.now() - stat.mtimeMs >= maxAge) removeTemporaryMediaDirectory(target)
    } catch {}
  }
}

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
  cleanupStaleTemporaryMedia()
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
  for (const client of pendingSshClients.values()) {
    try { client.destroy() } catch {}
  }
  pendingSshClients.clear()
  for (const [id, s] of sessions) {
    try { s.kill() } catch {}
    try { closeTunnelsFor(id) } catch {}
    try { stopMonitor(id) } catch {}
    cleanupTemporaryMedia(id)
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
    cleanupTemporaryMedia(id)
    send('session:exit', { id, code: exitCode, reason: 'exit' })
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
  const displayFingerprint = (value) => /^[0-9a-f]{64}$/i.test(String(value || ''))
    ? 'SHA256:' + Buffer.from(value, 'hex').toString('base64').replace(/=+$/, '')
    : String(value || '')
  const detail = changed
    ? mt('The server key changed. This may mean the server was reinstalled or a man-in-the-middle attack is in progress.\n\nSaved: ', 'Ключ сервера изменился. Это может означать переустановку сервера или атаку посредника.\n\nСохранённый: ') + displayFingerprint(known) + mt('\nNew: ', '\nНовый: ') + displayFingerprint(fingerprint)
    : mt('This server is not yet known to MeowShell. Verify the fingerprint with the server administrator.\n\n', 'Сервер ещё не известен MeowShell. Сверь fingerprint с администратором сервера.\n\n') + displayFingerprint(fingerprint)
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
    pendingSshClients.set(id, client)
    let settled = false
    let shellTimer = null
    const done = (result) => {
      if (settled) return false
      settled = true
      if (shellTimer) clearTimeout(shellTimer)
      pendingSshClients.delete(id)
      if (result && result.error) {
        try { client.destroy() } catch {}
      }
      resolve(result)
      return true
    }

    const host = String(cfg.host || '').trim()
    const username = String(cfg.username || '').trim()
    const port = validPort(cfg.port, 22)
    if (!validSshEndpoint(host, username)) return done({ error: 'Некорректный SSH-адрес или пользователь' })
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
        const keyStat = fs.lstatSync(cfg.keyPath)
        if (!keyStat.isFile() || keyStat.size > 16 * 1024 * 1024) throw new Error('файл ключа недопустим или слишком большой')
        connOpts.privateKey = fs.readFileSync(cfg.keyPath)
      } catch (err) {
        return done({ error: 'Не удалось прочитать ключ: ' + err.message })
      }
      if (cfg.passphrase) connOpts.passphrase = cfg.passphrase
    }
    if (cfg.password) connOpts.password = cfg.password

    client.on('ready', () => {
      shellTimer = setTimeout(() => done({ error: 'SSH-сервер не открыл терминал за 15 секунд' }), 15000)
      client.shell(
        { term: 'xterm-256color', cols: cfg.cols || 80, rows: cfg.rows || 24 },
        (err, stream) => {
          if (settled) {
            try { stream && stream.close() } catch {}
            return
          }
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
          let exitCode = null
          let exitSignal = null
          stream.on('exit', (code, signal) => {
            if (Number.isInteger(code)) exitCode = code
            if (signal) exitSignal = String(signal)
          })
          stream.on('close', () => {
            sessions.delete(id)
            try { closeTunnelsFor(id) } catch {}
            try { stopMonitor(id) } catch {}
            try { client.end() } catch {}
            send('session:exit', {
              id,
              code: exitCode,
              signal: exitSignal,
              reason: exitCode !== null || exitSignal ? 'exit' : 'disconnect',
            })
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
    client.on('end', () => done({ error: 'SSH-сервер закрыл соединение до открытия терминала' }))
    client.on('close', () => done({ error: 'SSH-соединение закрыто до открытия терминала' }))
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
  cleanupTemporaryMedia(id)
})

// ---------- SFTP ----------

function getSftp(id) {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh') return Promise.reject(new Error('SFTP доступен только для SSH-вкладок'))
  return getRetryableSftp(s)
}

function remotePath(value) {
  return normalizeRemotePath(value)
}

handleIpc('sftp:list', async (e, { id, path: dir }) => {
  try {
    const sftp = await getSftp(id)
    // превращаем путь в абсолютный (чтобы кнопка «вверх» доходила до корня /)
    const abs = remotePath(await callSftp(sftp, 'realpath', remotePath(dir || '.')))
    const list = await readDirectoryLimited(sftp, abs)
    const entries = []
    for (const x of list.slice(0, 10000)) {
      try {
        entries.push({
          name: safeRemoteEntryName(x.filename),
          isDir: x.attrs.isDirectory(),
          size: x.attrs.size,
          mtime: x.attrs.mtime,
        })
      } catch {}
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return { entries, path: abs, truncated: false }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:download', async (e, { id, remotePath, name }) => {
  try {
    const sftp = await getSftp(id)
    const res = await dialog.showSaveDialog(win, { defaultPath: safeEntryName(name) })
    if (res.canceled || !res.filePath) return { canceled: true }
    const source = normalizeRemotePath(remotePath)
    await fastGetAtomic(sftp, source, path.resolve(res.filePath))
    return { ok: true, localPath: res.filePath }
  } catch (err) {
    return { error: err.message }
  }
})

// v2.1: рекурсивное скачивание папки целиком
async function sftpWalkDownload(sftp, remoteDir, localDir, state = { files: 0, entries: 0 }, depth = 0) {
  if (depth > 64) throw new Error('Слишком большая глубина удалённого каталога')
  if (fs.existsSync(localDir) && fs.lstatSync(localDir).isSymbolicLink()) {
    throw new Error('Скачивание через локальную символическую ссылку запрещено')
  }
  fs.mkdirSync(localDir, { recursive: true })
  const list = await readDirectoryLimited(sftp, remoteDir)
  let count = 0
  const names = new Set()
  for (const it of list) {
    state.entries++
    if (state.entries > 100000) throw new Error('В каталоге слишком много элементов для одной операции')
    const name = safeEntryName(it.filename)
    const collisionKey = process.platform === 'win32' ? name.toLocaleLowerCase('en-US') : name
    if (names.has(collisionKey)) throw new Error('Удалённый каталог содержит конфликтующие имена: ' + name)
    names.add(collisionKey)
    const rp = path.posix.join(remoteDir, safeRemoteEntryName(it.filename))
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
      await fastGetAtomic(sftp, rp, lp)
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
    const parent = path.resolve(res.filePaths[0])
    const target = resolveLocalChild(parent, name)
    if (fs.existsSync(target)) throw new Error('Папка назначения уже существует; выбери другой каталог или переименуй её')
    try {
      const count = await sftpWalkDownload(sftp, normalizeRemotePath(remotePath), target)
      return { ok: true, localPath: target, count }
    } catch (err) {
      const relative = path.relative(parent, target)
      if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
        try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
      }
      throw err
    }
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
    const remote = path.posix.join(normalizeRemotePath(remoteDir || '.'), safeRemoteEntryName(path.basename(local)))
    const existing = await lstatMaybe(sftp, remote)
    if (existing) {
      if (typeof existing.isDirectory === 'function' && existing.isDirectory()) throw new Error('По этому пути уже существует каталог')
      const answer = await dialog.showMessageBox(win, {
        type: 'warning',
        title: mt('Replace remote file?', 'Заменить удалённый файл?'),
        message: path.posix.basename(remote),
        detail: mt('The existing file will be replaced atomically.', 'Существующий файл будет заменён атомарно.'),
        buttons: [mt('Cancel', 'Отмена'), mt('Replace', 'Заменить')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (answer.response !== 1) return { canceled: true }
    }
    const localMode = fs.statSync(local).mode & 0o777
    await fastPutAtomic(sftp, local, remote, { overwrite: !!existing, mode: localMode })
    return { ok: true, remote }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:mkdir', async (e, { id, parent, name }) => {
  try {
    const sftp = await getSftp(id)
    const dirPath = path.posix.join(normalizeRemotePath(parent || '.'), safeRemoteEntryName(name))
    await new Promise((r, j) => sftp.mkdir(dirPath, (err) => (err ? j(err) : r())))
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

// Загрузка конкретных локальных файлов (drag&drop) с прогрессом
handleIpc('files:grant-upload', (e, paths) => {
  pruneExpired(uploadGrants)
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
    pruneExpired(uploadGrants)
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
      const name = safeRemoteEntryName(path.basename(local))
      const remote = path.posix.join(normalizeRemotePath(remoteDir || '.'), name)
      const existing = await lstatMaybe(sftp, remote)
      if (existing) {
        if (typeof existing.isDirectory === 'function' && existing.isDirectory()) throw new Error('По пути «' + name + '» уже существует каталог')
        const answer = await dialog.showMessageBox(win, {
          type: 'warning',
          title: mt('Replace remote file?', 'Заменить удалённый файл?'),
          message: name,
          buttons: [mt('Skip', 'Пропустить'), mt('Replace', 'Заменить')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (answer.response !== 1) continue
      }
      await fastPutAtomic(sftp, local, remote, {
        overwrite: !!existing,
        mode: stat.mode & 0o777,
        fastPut: { step: (done, chunk, total) => send('sftp:progress', { id, name, done, total }) },
      })
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
  let temporaryDirectory = null
  try {
    let localPath = null

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
        temporaryDirectory = dir
        localPath = path.join(dir, 'screenshot.png')
        fs.writeFileSync(localPath, img.toPNG())
      }
    }

    if (!localPath) return { handled: false }

    if (s.type === 'local') {
      s.write(quotePathForShell(localPath, s.shell))
      if (temporaryDirectory) {
        rememberTemporaryMedia(id, temporaryDirectory)
        temporaryDirectory = null
      }
      return { handled: true, path: localPath }
    }

    // SSH: отдельная закрытая папка в домашнем каталоге и случайное имя.
    const sftp = await getSftp(id)
    const home = await callSftp(sftp, 'realpath', '.')
    const cache = home.replace(/\/+$/, '') + '/.meowshell'
    await ensurePrivateDirectory(sftp, cache)
    const ext = path.extname(localPath).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12)
    const remote = cache + '/paste-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext
    try {
      await fastPutAtomic(sftp, localPath, remote, { mode: 0o600 })
    } finally {
      if (temporaryDirectory) removeTemporaryMediaDirectory(temporaryDirectory)
      temporaryDirectory = null
    }
    s.write(quotePosix(remote))
    return { handled: true, path: remote }
  } catch (err) {
    if (temporaryDirectory) removeTemporaryMediaDirectory(temporaryDirectory)
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
    replaceLocalFile(result.filePath, JSON.stringify(exportableConfig(loadConfig()), null, 2), 0o600)
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('config:import-preview', async () => {
  try {
    pruneExpired(pendingConfigImports)
    const result = await dialog.showOpenDialog(win, {
      title: mt('Import MeowShell configuration', 'Импорт конфигурации MeowShell'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    const stat = fs.lstatSync(result.filePaths[0])
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw new Error('Configuration file is invalid or too large')
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
    pruneExpired(pendingConfigImports)
    if (!payload || (payload.mode !== 'replace' && payload.mode !== 'merge')) throw new Error('Unknown import mode')
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

function clearManagedDirectory(directory) {
  const target = path.resolve(String(directory || ''))
  if (!target || target === path.parse(target).root || !fs.existsSync(target)) return
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Небезопасный каталог очистки: ' + target)
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.resolve(target, entry.name)
    const relative = path.relative(target, child)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Небезопасная цель очистки: ' + child)
    }
    fs.rmSync(child, { recursive: true, force: true })
  }
}

function removeManagedFile(file) {
  const target = path.resolve(String(file || ''))
  if (!target || target === path.parse(target).root || !fs.existsSync(target)) return
  const stat = fs.lstatSync(target)
  if (stat.isDirectory() && !stat.isSymbolicLink()) throw new Error('Ожидался файл: ' + target)
  fs.unlinkSync(target)
}

function clearAllLocalData() {
  const userData = path.resolve(app.getPath('userData'))
  clearManagedDirectory(path.join(userData, 'backups'))
  clearManagedDirectory(path.dirname(errorLogPath))
  clearManagedDirectory(app.getPath('crashDumps'))
  removeManagedFile(legacyErrorLogPath)
  removeManagedFile(legacyErrorLogPath + '.1')
  const marker = gpuMarkerPath()
  if (marker) removeManagedFile(marker)
  for (const entry of fs.readdirSync(userData, { withFileTypes: true })) {
    if (entry.isFile() && /^meowshell-config\.(?:corrupt-|json\.tmp-)/.test(entry.name)) {
      removeManagedFile(path.join(userData, entry.name))
    }
  }
  for (const id of temporaryMediaBySession.keys()) cleanupTemporaryMedia(id)
  cleanupStaleTemporaryMedia(0)
  selectedLocalFiles.clear()
  localResources.clear()
  uploadGrants.clear()
  pendingConfigImports.clear()
  configRecovery = null
  suppressShutdownLog = true
}

handleIpc('config:reset', (e, mode) => {
  try {
    if (mode !== 'settings' && mode !== 'all') throw new Error('Unknown reset mode')
    const cfg = loadConfig()
    const backupPath = mode === 'all' ? null : backupConfig('before-reset')
    if (mode === 'all') {
      cfg.connections = []
      cfg.settings = {}
      cfg.knownHosts = {}
    } else {
      cfg.settings = {}
    }
    if (!saveConfig(cfg)) throw new Error('Could not reset configuration')
    if (mode === 'all') clearAllLocalData()
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

onIpc('app:smoke-ready', (e, result) => {
  if (!ciSmokeTest) return
  if (!result || result.ok !== true) {
    logLine('[smoke] FAIL: ' + String(result && result.error || 'unknown renderer failure'))
    return app.exit(1)
  }
  logLine('[smoke] PASS: renderer initialized and local PTY completed input/output/resize')
  setTimeout(() => app.exit(0), 250)
})

handleIpc('config:save-connection', (e, conn) => {
  try {
    if (!conn || typeof conn !== 'object') return { error: 'Некорректные данные подключения' }
    const cfg = loadConfig()
    const current = conn.id ? cfg.connections.find((item) => item.id === conn.id) : null
    const requestedKeyPath = Object.prototype.hasOwnProperty.call(conn, 'keyPath')
      ? conn.keyPath
      : (current && current.keyPath) || ''
    const authMode = conn.authMode === 'key' || (conn.authMode == null && String(requestedKeyPath || '').trim())
      ? 'key'
      : 'password'
    const generatedId = typeof conn.id === 'string' && conn.id
      ? conn.id
      : Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
    const clean = sanitizeConnection({
      id: generatedId,
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authMode,
      keyPath: authMode === 'key' ? requestedKeyPath : '',
      tunnels: Array.isArray(conn.tunnels) ? conn.tunnels : (current && current.tunnels) || [],
      password: '',
      passphrase: '',
    })
    if (!clean) return { error: 'Укажи корректные хост и имя пользователя' }
    const sameEndpoint = !!current && current.host === clean.host && current.port === clean.port && current.username === clean.username
    if (authMode === 'password') {
      if (typeof conn.password === 'string' && conn.password) clean.password = encSecret(conn.password)
      else if (!conn.clearPassword && sameEndpoint && current.authMode === 'password') clean.password = current.password || ''
    } else {
      if (typeof conn.passphrase === 'string' && conn.passphrase) clean.passphrase = encSecret(conn.passphrase)
      else if (!conn.clearPassphrase && sameEndpoint && current.authMode === 'key') clean.passphrase = current.passphrase || ''
    }
    if (clean.id) {
      const i = cfg.connections.findIndex((c) => c.id === clean.id)
      if (i >= 0) cfg.connections[i] = clean
      else cfg.connections.push(clean)
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

handleIpc('ssh:format-command', (e, connection) => {
  try { return { command: formatSshCommand(connection) } } catch (err) { return { error: err.message } }
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
    const stat = fs.lstatSync(res.filePaths[0])
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) return { error: 'Файл конфигурации недопустим или слишком большой' }
    const doc = yaml.load(fs.readFileSync(res.filePaths[0], 'utf8'), {
      schema: yaml.JSON_SCHEMA,
      json: true,
    })
    const profiles = Array.isArray(doc && doc.profiles) ? doc.profiles.slice(0, 10000) : []
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
      const imported = sanitizeConnection({
        id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
        name: String(p.name || user + '@' + p.options.host).trim().slice(0, 200),
        host: String(p.options.host).trim().slice(0, 253),
        port,
        username: String(user).trim().slice(0, 128),
        authMode: keyPath ? 'key' : 'password',
        keyPath: keyPath.slice(0, 4096),
        password: '',
        passphrase: '',
      })
      if (!imported) continue
      cfg.connections.push(imported)
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
    const wasSelected = selectedLocalFiles.delete(filePath)
    const type = payload && payload.type
    const allowed = type === 'image' ? /\.(?:png|jpe?g|gif|webp|bmp)$/i : /$a/
    if (!wasSelected || !allowed.test(filePath) || !fs.statSync(filePath).isFile()) return null
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
  const st = await callSftp(sftp, 'lstat', target)
  if (st.isDirectory()) {
    const remaining = Math.max(1, 100000 - state.entries)
    const list = await readDirectoryLimited(sftp, target, { maxEntries: remaining })
    for (const item of list) {
      const name = safeRemoteEntryName(item && item.filename)
      await sftpRmrf(sftp, path.posix.join(target, name), state, depth + 1)
    }
    await callSftp(sftp, 'rmdir', target)
  } else {
    await callSftp(sftp, 'unlink', target)
  }
}

handleIpc('sftp:rename', async (e, { id, from, to }) => {
  try {
    from = normalizeRemotePath(from)
    to = normalizeRemotePath(to)
    safeRemoteEntryName(path.posix.basename(to))
    if (path.posix.dirname(from) !== path.posix.dirname(to)) throw new Error('Переименование не может перемещать файл в другой каталог')
    const sftp = await getSftp(id)
    if (await lstatMaybe(sftp, to)) throw new Error('Файл с таким именем уже существует')
    await callSftp(sftp, 'rename', from, to)
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:chmod', async (e, { id, path: p, mode }) => {
  try {
    if (!/^[0-7]{3,4}$/.test(String(mode))) return { error: 'Неверный режим chmod' }
    p = normalizeRemotePath(p)
    const sftp = await getSftp(id)
    await callSftp(sftp, 'chmod', p, parseInt(String(mode), 8))
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:delete', async (e, { id, path: p }) => {
  try {
    p = normalizeRemotePath(p)
    if (isDangerousRemoteTarget(p)) return { error: 'Корневой каталог удалять нельзя' }
    const sftp = await getSftp(id)
    await sftpRmrf(sftp, p)
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:read-file', async (e, { id, path: p }) => {
  try {
    p = normalizeRemotePath(p)
    const sftp = await getSftp(id)
    const result = await readFileLimited(sftp, p, MAX_EDITOR_BYTES)
    let content
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(result.buffer)
    } catch {
      return { error: 'Файл не является корректным UTF-8 текстом; редактирование отменено, чтобы не повредить данные' }
    }
    if (content.includes('\0')) return { error: 'Файл похож на бинарный; встроенный редактор его не изменяет' }
    return { content, version: result.version }
  } catch (err) {
    return { error: err.message }
  }
})

handleIpc('sftp:write-file', async (e, { id, path: p, content, version }) => {
  try {
    p = normalizeRemotePath(p)
    content = String(content == null ? '' : content)
    if (Buffer.byteLength(content, 'utf8') > MAX_EDITOR_BYTES) return { error: 'Файл слишком большой для редактора (макс. 2 МБ)' }
    if (typeof version !== 'string' || !/^\d+:\d+:[0-9a-f]{64}$/.test(version)) return { error: 'Версия файла устарела; открой файл заново' }
    const sftp = await getSftp(id)
    const current = await readFileLimited(sftp, p, MAX_EDITOR_BYTES)
    if (current.version !== version) {
      return { error: 'Удалённый файл изменился после открытия. Перезагрузите его перед сохранением.' }
    }
    const encoded = Buffer.from(content, 'utf8')
    const nextStatVersion = await atomicRemoteWrite(
      sftp,
      p,
      (temporary) => callSftp(sftp, 'writeFile', temporary, encoded),
      { expectedVersion: fileVersion(current.attrs) }
    )
    return { ok: true, version: nextStatVersion + ':' + crypto.createHash('sha256').update(encoded).digest('hex') }
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

function closeTunnel(tunnel) {
  if (!tunnel || tunnel.closed) return
  tunnel.closed = true
  destroyResources(tunnel.connections)
  if (tunnel.connections) tunnel.connections.clear()
  try { tunnel.server && tunnel.server.close() } catch {}
}

handleIpc('tunnel:start', (e, { id, localPort, remoteHost, remotePort }) => {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh' || !s.client) return { error: 'нет активной SSH-сессии' }
  const lp = validPort(localPort)
  const rp = validPort(remotePort)
  if (!lp || !rp) return { error: 'неверный порт' }
  remoteHost = String(remoteHost || '127.0.0.1').trim()
  if (!validSshEndpoint(remoteHost, 'tunnel')) return { error: 'неверный адрес назначения' }
  const key = id + ':' + lp
  if (tunnels.has(key)) return { error: 'порт ' + lp + ' уже проброшен' }
  return new Promise((resolve) => {
    let resolved = false
    const tunnel = { server: null, sessId: id, connections: new Set(), closed: false }
    const server = netV9.createServer((socket) => {
      if (tunnel.closed || tunnels.get(key) !== tunnel) return socket.destroy()
      tunnel.connections.add(socket)
      socket.once('close', () => tunnel.connections.delete(socket))
      s.client.forwardOut('127.0.0.1', socket.remotePort || 0, remoteHost || '127.0.0.1', rp, (err, stream) => {
        if (err) { try { socket.destroy() } catch {} ; return }
        if (tunnel.closed || tunnels.get(key) !== tunnel) {
          try { stream.destroy() } catch {}
          try { socket.destroy() } catch {}
          return
        }
        tunnel.connections.add(stream)
        stream.once('close', () => tunnel.connections.delete(stream))
        socket.pipe(stream).pipe(socket)
        stream.on('error', () => { try { socket.destroy() } catch {} })
        socket.on('error', () => { try { stream.destroy() } catch {} })
      })
    })
    tunnel.server = server
    server.on('error', (err) => {
      tunnels.delete(key)
      closeTunnel(tunnel)
      if (!resolved) {
        resolved = true
        resolve({ error: err.code === 'EADDRINUSE' ? 'порт ' + lp + ' уже занят на этом компьютере' : err.message })
      }
    })
    tunnels.set(key, tunnel)
    try {
      server.listen(lp, '127.0.0.1', () => {
        if (!resolved) { resolved = true; resolve({ ok: true }) }
      })
    } catch (err) {
      tunnels.delete(key)
      closeTunnel(tunnel)
      resolved = true
      resolve({ error: err.message })
    }
  })
})

handleIpc('tunnel:stop', (e, { id, localPort }) => {
  const key = id + ':' + parseInt(localPort, 10)
  const t = tunnels.get(key)
  if (t) {
    closeTunnel(t)
    tunnels.delete(key)
  }
  return { ok: true }
})

function closeTunnelsFor(id) {
  for (const [k, t] of [...tunnels]) {
    if (t.sessId === id) {
      closeTunnel(t)
      tunnels.delete(k)
    }
  }
}

// --- мониторинг сервера (CPU/RAM/диск/аптайм по SSH) ---
const monitors = new Map()

function stopMonitor(id) {
  const m = monitors.get(id)
  if (m) {
    clearInterval(m.timer)
    if (m.state && m.state.stream) {
      try { m.state.stream.destroy() } catch {}
    }
    if (m.state && m.state.timeout) clearTimeout(m.state.timeout)
    monitors.delete(id)
  }
}

onIpc('monitor:stop', (e, { id }) => stopMonitor(id))

onIpc('monitor:start', (e, { id, interval }) => {
  const s = sessions.get(id)
  if (!s || s.type !== 'ssh' || !s.client) return
  stopMonitor(id)
  const state = {}
  const monitor = { timer: null, state }
  monitors.set(id, monitor)
  const cmd = "cat /proc/stat 2>/dev/null | head -1; echo @@; free -b 2>/dev/null | grep -i '^mem'; echo @@; df -B1 -P / 2>/dev/null | tail -1; echo @@; cat /proc/uptime 2>/dev/null"
  const tick = () => {
    if (!sessions.has(id)) return stopMonitor(id)
    if (state.busy) return
    state.busy = true
    try {
      s.client.exec(cmd, (err, stream) => {
        if (err) { state.busy = false; return }
        if (monitors.get(id) !== monitor) {
          try { stream.destroy() } catch {}
          state.busy = false
          return
        }
        let out = ''
        let received = 0
        let failed = false
        let finished = false
        state.stream = stream
        const finish = () => {
          if (finished) return false
          finished = true
          if (state.timeout) clearTimeout(state.timeout)
          state.timeout = null
          if (state.stream === stream) state.stream = null
          state.busy = false
          return true
        }
        const receive = (d, keep) => {
          received += d.length
          if (received > 256 * 1024) {
            failed = true
            try { stream.destroy() } catch {}
            finish()
            return
          }
          if (keep) out += d.toString('utf8')
        }
        stream.on('data', (d) => receive(d, true))
        stream.stderr.on('data', (d) => receive(d, false))
        stream.on('error', () => finish())
        state.timeout = setTimeout(() => {
          failed = true
          try { stream.destroy() } catch {}
          finish()
        }, 10000)
        stream.on('close', () => {
          if (!finish() || failed || monitors.get(id) !== monitor) return
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
  monitor.timer = setInterval(tick, delay)
})

// --- генерация SSH-ключей и установка на сервер ---
async function restrictPrivateKeyPermissions(file) {
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o600)
    return
  }
  const script = [
    '$p=$env:MEOWSHELL_PRIVATE_KEY_PATH',
    'if ([string]::IsNullOrWhiteSpace($p)) { throw "Missing private-key path" }',
    '$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()',
    '$acl=New-Object System.Security.AccessControl.FileSecurity',
    '$acl.SetOwner($identity.User)',
    '$acl.SetAccessRuleProtection($true,$false)',
    '$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User,"FullControl","Allow")',
    '$acl.AddAccessRule($rule)',
    'Set-Acl -LiteralPath $p -AclObject $acl',
  ].join(';')
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript],
      {
        windowsHide: true,
        timeout: 15000,
        env: Object.assign({}, process.env, { MEOWSHELL_PRIVATE_KEY_PATH: path.resolve(file) }),
      },
      (err) => (err ? reject(new Error('Не удалось ограничить ACL приватного ключа: ' + err.message)) : resolve())
    )
  })
}

handleIpc('ssh:keygen', async (e, { type, comment, passphrase }) => {
  let utils
  try { utils = require('ssh2').utils } catch (err) { return { error: err.message } }
  if (!utils || typeof utils.generateKeyPair !== 'function') return { error: 'эта версия ssh2 не умеет генерировать ключи' }
  const kt = type === 'rsa' ? 'rsa' : 'ed25519'
  const opts = { comment: String(comment || 'meowshell').replace(/[\r\n]/g, ' ').slice(0, 200) }
  if (kt === 'rsa') opts.bits = 4096
  passphrase = String(passphrase || '')
  if (passphrase.length > 4096) return { error: 'пароль ключа слишком длинный' }
  if (passphrase) { opts.passphrase = passphrase; opts.cipher = 'aes256-cbc' }
  let pair
  try {
    pair = await new Promise((resolve, reject) =>
      utils.generateKeyPair(kt, opts, (err, keys) => (err ? reject(err) : resolve(keys)))
    )
  } catch (err) { return { error: err.message } }
  const def = path.join(os.homedir(), '.ssh', 'id_' + kt)
  const r = await dialog.showSaveDialog(win, { title: mt('Save the private key', 'Куда сохранить приватный ключ'), defaultPath: def })
  if (r.canceled || !r.filePath) return { canceled: true }
  try {
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true })
    if (fs.existsSync(r.filePath + '.pub')) throw new Error('Публичный файл уже существует: ' + r.filePath + '.pub')
    const privateTmp = r.filePath + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex')
    const publicTmp = r.filePath + '.pub.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex')
    const privateBackup = r.filePath + '.backup-' + crypto.randomBytes(4).toString('hex')
    let hadPrivate = false
    let privateInstalled = false
    let publicInstalled = false
    try {
      fs.writeFileSync(privateTmp, pair.private, { mode: 0o600, flag: 'wx' })
      fs.writeFileSync(publicTmp, pair.public, { mode: 0o644, flag: 'wx' })
      if (fs.existsSync(r.filePath)) {
        fs.renameSync(r.filePath, privateBackup)
        hadPrivate = true
      }
      fs.renameSync(privateTmp, r.filePath)
      privateInstalled = true
      fs.renameSync(publicTmp, r.filePath + '.pub')
      publicInstalled = true
      await restrictPrivateKeyPermissions(r.filePath)
      if (hadPrivate) fs.unlinkSync(privateBackup)
    } catch (err) {
      if (publicInstalled) { try { fs.unlinkSync(r.filePath + '.pub') } catch {} }
      if (privateInstalled) { try { fs.unlinkSync(r.filePath) } catch {} }
      if (hadPrivate) { try { fs.renameSync(privateBackup, r.filePath) } catch {} }
      throw err
    } finally {
      try { fs.unlinkSync(privateTmp) } catch {}
      try { fs.unlinkSync(publicTmp) } catch {}
    }
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
    let settled = false
    let timer = null
    const done = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    const command = 'umask 077; mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" && touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys" && IFS= read -r key && (grep -qxF -- "$key" "$HOME/.ssh/authorized_keys" || printf \'%s\\n\' "$key" >> "$HOME/.ssh/authorized_keys")'
    s.client.exec(command, (err, stream) => {
      if (err) return done({ error: err.message })
      let errOut = ''
      stream.stderr.on('data', (d) => {
        if (Buffer.byteLength(errOut, 'utf8') < 64 * 1024) errOut += d.toString('utf8').slice(0, 64 * 1024)
        if (Buffer.byteLength(errOut, 'utf8') >= 64 * 1024) {
          try { stream.destroy() } catch {}
          done({ error: 'Сервер вернул слишком большой ответ при установке ключа' })
        }
      })
      stream.on('error', (streamError) => done({ error: streamError.message }))
      stream.on('close', (code) => done(code === 0 ? { ok: true } : { error: errOut.trim() || ('код ' + code) }))
      timer = setTimeout(() => {
        try { stream.destroy() } catch {}
        done({ error: 'Установка ключа не завершилась за 15 секунд' })
      }, 15000)
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
