'use strict'

const path = require('path')

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

function normalizeConfig(value) {
  const cfg = asObject(value)
  return {
    connections: Array.isArray(cfg.connections)
      ? cfg.connections.filter((item) => item && typeof item === 'object').slice(0, 10000).map((item) => cleanValue(item))
      : [],
    settings: cleanValue(asObject(cfg.settings)),
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
  const normalized = normalizeRemotePath(value)
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
  // Двойные кавычки защищают пробелы и командные разделители. Знак процента
  // экранируется отдельно, чтобы cmd.exe не разворачивал переменные окружения.
  return '"' + String(value).replace(/%/g, '^%').replace(/"/g, '') + '"'
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

module.exports = {
  normalizeConfig,
  normalizeRemotePath,
  isDangerousRemoteTarget,
  quotePathForShell,
  quotePosix,
  resolveLocalChild,
  safeEntryName,
  safeRemoteEntryName,
  validPort,
}
