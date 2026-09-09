'use strict'

const path = require('path')

const MAX_CONFIG_BYTES = 10 * 1024 * 1024
const MAX_EDITOR_BYTES = 2 * 1024 * 1024

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function cleanValue(value, state = { entries: 0 }, depth = 0) {
  if (depth > 32) throw new Error('Конфигурация имеет слишком большую глубину')
  if (Array.isArray(value)) {
    state.entries += value.length
    if (state.entries > 100000) throw new Error('Конфигурация содержит слишком много элементов')
    return value.map((item) => cleanValue(item, state, depth + 1))
  }
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    state.entries++
    if (state.entries > 100000) throw new Error('Конфигурация содержит слишком много элементов')
    out[key] = cleanValue(item, state, depth + 1)
  }
  return out
}

function boundedString(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback
  return value.slice(0, max)
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function optionalBoolean(source, key, out) {
  if (typeof source[key] === 'boolean') out[key] = source[key]
}

function sanitizeTunnel(value) {
  const tunnel = asObject(value)
  const localPort = validPort(tunnel.localPort)
  const remotePort = validPort(tunnel.remotePort)
  const remoteHost = boundedString(tunnel.remoteHost || '127.0.0.1', 253).trim()
  if (!localPort || !remotePort || !remoteHost || /[\0\r\n\s]/.test(remoteHost)) return null
  return { localPort, remoteHost, remotePort, auto: tunnel.auto === true }
}

function sanitizeConnection(value) {
  const connection = asObject(value)
  const host = boundedString(connection.host, 253).trim()
  const username = boundedString(connection.username, 128).trim()
  if (!validSshEndpoint(host, username)) return null
  const keyPath = boundedString(connection.keyPath, 4096).trim()
  const authMode = connection.authMode === 'key' || (connection.authMode == null && keyPath) ? 'key' : 'password'
  return {
    id: boundedString(connection.id, 200),
    name: boundedString(connection.name, 200).trim(),
    host,
    port: validPort(connection.port, 22),
    username,
    authMode,
    keyPath: authMode === 'key' ? keyPath : '',
    tunnels: Array.isArray(connection.tunnels)
      ? connection.tunnels.slice(0, 100).map(sanitizeTunnel).filter(Boolean)
      : [],
    password: authMode === 'password' ? boundedString(connection.password, 65536) : '',
    passphrase: authMode === 'key' ? boundedString(connection.passphrase, 65536) : '',
  }
}

function sanitizeColor(value, fallback) {
  const color = typeof value === 'string' ? value.trim() : ''
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback
}

function sanitizeCustomThemes(value) {
  const themes = asObject(value)
  const out = {}
  const uiKeys = ['bg', 'bg2', 'bg3', 'border', 'fg', 'fgDim', 'accent']
  const termKeys = [
    'background', 'foreground', 'cursor', 'selectionBackground',
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
    'brightMagenta', 'brightCyan', 'brightWhite',
  ]
  for (const [rawKey, rawTheme] of Object.entries(themes).slice(0, 50)) {
    const key = boundedString(rawKey, 100).replace(/[^a-zA-Z0-9_-]/g, '')
    const theme = asObject(rawTheme)
    if (!key || !theme.label || !theme.ui || !theme.xterm) continue
    const ui = {}
    const xterm = {}
    for (const item of uiKeys) ui[item] = sanitizeColor(theme.ui[item], item === 'fg' ? '#e6edf3' : '#0d1117')
    for (const item of termKeys) xterm[item] = sanitizeColor(theme.xterm[item], item === 'foreground' ? '#e6edf3' : '#0d1117')
    out[key] = { label: boundedString(theme.label, 100).trim() || key, ui, xterm }
  }
  return out
}

function sanitizeSettings(value) {
  const settings = asObject(value)
  const out = {}
  const enumValue = (key, values) => {
    if (values.includes(settings[key])) out[key] = settings[key]
  }
  const stringValue = (key, max) => {
    if (typeof settings[key] === 'string') out[key] = settings[key].slice(0, max)
  }
  const numberValue = (key, min, max, integer = false) => {
    if (!Number.isFinite(Number(settings[key]))) return
    const value = boundedNumber(settings[key], min, max, min)
    out[key] = integer ? Math.round(value) : value
  }

  enumValue('language', ['auto', 'en', 'ru'])
  enumValue('cursorStyle', ['block', 'underline', 'bar'])
  enumValue('altWheel', ['page', 'one', 'xterm', 'off'])
  enumValue('typingFx', ['glow', 'sparks', 'off'])
  enumValue('fontWeight', ['normal', '500', '600', 'bold'])
  enumValue('broadcastScope', ['splits', 'all'])
  enumValue('bracketedPaste', ['auto', 'always'])
  for (const [key, max] of [
    ['theme', 100], ['fontFamily', 1000], ['shell', 4096], ['bgImage', 4096],
    ['quakeHotkey', 100], ['uiFont', 200],
  ]) stringValue(key, max)
  for (const [key, min, max, integer] of [
    ['fontSize', 8, 32, true], ['scrollback', 500, 100000, true],
    ['lineHeight', 1, 2, false], ['letterSpacing', 0, 8, false],
    ['scrollSensitivity', 1, 10, false], ['bgDim', 0, 100, false],
    ['bgBlur', 0, 100, false], ['quakeHeight', 20, 100, false],
    ['monitorInterval', 2, 60, false],
  ]) numberValue(key, min, max, integer)
  for (const key of [
    'cursorBlink', 'copyOnSelect', 'smoothCursor', 'smoothTextAnimation',
    'webglRenderer', 'autoReconnect', 'quakeEnabled', 'quakeDock', 'restoreTabs',
    'pasteGuard', 'pasteTrimEnd', 'rightClickPaste', 'ctrlCCopy',
    'onboardingComplete',
  ]) optionalBoolean(settings, key, out)

  out.snippets = Array.isArray(settings.snippets)
    ? settings.snippets.slice(0, 500).map((item) => {
      const snippet = asObject(item)
      const name = boundedString(snippet.name, 100).trim()
      const cmd = boundedString(snippet.cmd, 65536)
      return name && cmd ? { name, cmd, enter: snippet.enter !== false } : null
    }).filter(Boolean)
    : []
  out.lastTabs = Array.isArray(settings.lastTabs)
    ? settings.lastTabs.slice(0, 100).map((item) => {
      const tab = asObject(item)
      if (tab.type === 'local') return { type: 'local' }
      const connId = boundedString(tab.connId, 200)
      return tab.type === 'ssh' && connId ? { type: 'ssh', connId } : null
    }).filter(Boolean)
    : []
  out.customThemes = sanitizeCustomThemes(settings.customThemes)
  if (!Object.prototype.hasOwnProperty.call(out, 'restoreTabs')) out.restoreTabs = false
  return out
}

function normalizeConfig(value) {
  const cfg = asObject(value)
  return {
    connections: Array.isArray(cfg.connections)
      ? cfg.connections.slice(0, 10000).map(sanitizeConnection).filter(Boolean)
      : [],
    settings: sanitizeSettings(cfg.settings),
    knownHosts: cleanValue(asObject(cfg.knownHosts)),
  }
}

function safeEntryName(value) {
  const name = String(value || '')
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  if (!name || name === '.' || name === '..' || path.basename(name) !== name ||
      /[\\/\0<>:"|?*]/.test(name) || /[. ]$/.test(name) || reserved) {
    throw new Error('Удалённый сервер вернул небезопасное имя файла')
  }
  return name
}

function safeRemoteEntryName(value) {
  const name = String(value || '')
  if (!name || name === '.' || name === '..' || /[\/\0]/.test(name) || Buffer.byteLength(name, 'utf8') > 255) {
    throw new Error('Небезопасное имя удалённого файла')
  }
  return name
}

function normalizeRemotePath(value) {
  const source = String(value || '')
  if (!source || source.length > 4096 || source.includes('\0')) throw new Error('Некорректный удалённый путь')
  const normalized = path.posix.normalize(source)
  if (!normalized || normalized.length > 4096) throw new Error('Некорректный удалённый путь')
  return normalized
}

function isDangerousRemoteTarget(value) {
  const normalized = normalizeRemotePath(value).replace(/\/+$/, '') || '/'
  return normalized === '/' || normalized === '.' || normalized === '..' || normalized.startsWith('../')
}

function resolveLocalChild(base, name) {
  const safeName = safeEntryName(name)
  const root = path.resolve(base)
  const target = path.resolve(root, safeName)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw new Error('Попытка записи за пределами выбранной папки')
  }
  return target
}

function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function quotePowerShell(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function quoteCmd(value) {
  const source = String(value)
  // В интерактивном cmd.exe раскрытие %VAR% и delayed expansion !VAR!
  // зависит от режима процесса и не имеет универсального безопасного escape.
  if (/[\r\n%\!^\"]/.test(source)) {
    throw new Error('Путь содержит символы, которые нельзя безопасно вставить в cmd.exe')
  }
  return '"' + source + '"'
}

function quotePathForShell(value, shell) {
  const name = path.basename(String(shell || '')).toLowerCase()
  if (name === 'powershell.exe' || name === 'pwsh.exe' || name === 'pwsh') return quotePowerShell(value)
  if (name === 'cmd.exe' || name === 'cmd') return quoteCmd(value)
  return quotePosix(value)
}

function validPort(value, fallback) {
  const port = Number(value)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port
  return fallback == null ? null : fallback
}

function validSshEndpoint(host, username) {
  host = String(host || '').trim()
  username = String(username || '').trim()
  if (!host || !username || host.length > 253 || username.length > 128) return false
  if (host.startsWith('-') || username.startsWith('-')) return false
  if (/[\0-\x20\x7f<>"'`$;&|(){}\[\]*?!\\]/.test(host + username)) return false
  return /^[\p{L}\p{N}._:+-]+$/u.test(host) && /^[\p{L}\p{N}._+-]+$/u.test(username)
}

function formatSshCommand(connection) {
  const host = String(connection && connection.host || '').trim()
  const username = String(connection && connection.username || '').trim()
  if (!validSshEndpoint(host, username)) throw new Error('Некорректный SSH-адрес или пользователь')
  const port = validPort(connection.port, 22)
  const targetHost = host.includes(':') && !/^\[.*\]$/.test(host) ? '[' + host + ']' : host
  return 'ssh ' + username + '@' + targetHost + (port !== 22 ? ' -p ' + port : '')
}

function resolveSshConnection(input, saved, decrypt = (value) => value || '') {
  const source = asObject(input)
  saved = saved && typeof saved === 'object' ? saved : null
  const id = typeof source.id === 'string' ? source.id : ''
  const pick = (key, fallback = '') => Object.prototype.hasOwnProperty.call(source, key)
    ? source[key]
    : (saved && saved[key]) || fallback
  const host = String(pick('host')).trim().slice(0, 253)
  const port = validPort(pick('port', 22), 22)
  const username = String(pick('username')).trim().slice(0, 128)
  const endpointMatches = !!saved && host === saved.host && port === saved.port && username === saved.username
  const authMode = source.authMode === 'key' ||
    (source.authMode == null && String(pick('keyPath')).trim()) ? 'key' : 'password'
  const keyPath = authMode === 'key' ? String(pick('keyPath')).trim().slice(0, 4096) : ''
  const credentialMatches = endpointMatches && saved.authMode === authMode &&
    (authMode !== 'key' || keyPath === saved.keyPath)
  const mayUseSavedSecret = source.useSavedCredentials === true && credentialMatches
  const suppliedPassword = typeof source.password === 'string' ? source.password.slice(0, 65536) : ''
  const suppliedPassphrase = typeof source.passphrase === 'string' ? source.passphrase.slice(0, 65536) : ''
  return {
    id,
    host,
    port,
    username,
    authMode,
    keyPath,
    password: authMode === 'password'
      ? (suppliedPassword || (mayUseSavedSecret ? decrypt(saved.password) : ''))
      : '',
    passphrase: authMode === 'key'
      ? (suppliedPassphrase || (mayUseSavedSecret ? decrypt(saved.passphrase) : ''))
      : '',
    cols: Math.min(1000, Math.max(2, Number(source.cols) || 80)),
    rows: Math.min(500, Math.max(1, Number(source.rows) || 24)),
  }
}

function destroyResources(resources) {
  let destroyed = 0
  for (const resource of resources || []) {
    try {
      if (resource && typeof resource.destroy === 'function') {
        resource.destroy()
        destroyed++
      }
    } catch {}
  }
  return destroyed
}

module.exports = {
  MAX_CONFIG_BYTES,
  MAX_EDITOR_BYTES,
  destroyResources,
  formatSshCommand,
  normalizeConfig,
  normalizeRemotePath,
  isDangerousRemoteTarget,
  quotePathForShell,
  quotePosix,
  resolveSshConnection,
  resolveLocalChild,
  safeEntryName,
  safeRemoteEntryName,
  sanitizeConnection,
  sanitizeSettings,
  validPort,
  validSshEndpoint,
}
