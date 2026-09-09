'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DEFAULT_MAX_ENTRIES = 10000
const DEFAULT_MAX_LIST_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024

function call(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      sftp[method](...args, (err, ...values) => {
        if (err) reject(err)
        else resolve(values.length <= 1 ? values[0] : values)
      })
    } catch (err) {
      reject(err)
    }
  })
}

function isEof(err) {
  return !!err && (err.code === 1 || err.code === 'EOF')
}

async function lstatMaybe(sftp, remotePath) {
  try {
    return await call(sftp, 'lstat', remotePath)
  } catch (err) {
    if (err && (err.code === 2 || err.code === 'ENOENT')) return null
    throw err
  }
}

async function closeHandle(sftp, handle) {
  if (!handle) return
  try { await call(sftp, 'close', handle) } catch {}
}

async function readDirectoryLimited(sftp, remotePath, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : DEFAULT_MAX_ENTRIES
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_LIST_BYTES
  const handle = await call(sftp, 'opendir', remotePath)
  const entries = []
  let bytes = 0
  try {
    while (true) {
      let batch
      try {
        batch = await call(sftp, 'readdir', handle)
      } catch (err) {
        if (isEof(err)) break
        throw err
      }
      if (!Array.isArray(batch) || batch.length === 0) break
      for (const entry of batch) {
        bytes += Buffer.byteLength(String(entry && entry.filename || ''), 'utf8')
        bytes += Buffer.byteLength(String(entry && entry.longname || ''), 'utf8')
        if (entries.length >= maxEntries || bytes > maxBytes) {
          const err = new Error('Удалённый каталог слишком большой для безопасного просмотра')
          err.code = 'SFTP_LIMIT'
          throw err
        }
        entries.push(entry)
      }
    }
    return entries
  } finally {
    await closeHandle(sftp, handle)
  }
}

async function readFileLimited(sftp, remotePath, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  const attrs = await call(sftp, 'lstat', remotePath)
  if (attrs && typeof attrs.isFile === 'function' && !attrs.isFile()) {
    throw new Error('Редактор поддерживает только обычные файлы')
  }
  if (attrs && Number(attrs.size) > maxBytes) {
    const err = new Error('Файл слишком большой для встроенного редактора')
    err.code = 'SFTP_LIMIT'
    throw err
  }
  const handle = await call(sftp, 'open', remotePath, 'r')
  const chunks = []
  let position = 0
  try {
    while (position <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - position))
      let result
      try {
        result = await call(sftp, 'read', handle, buffer, 0, buffer.length, position)
      } catch (err) {
        if (isEof(err)) break
        throw err
      }
      const values = Array.isArray(result) ? result : [result]
      const bytesRead = Number(values[0]) || 0
      const source = Buffer.isBuffer(values[1]) ? values[1] : buffer
      if (!bytesRead) break
      position += bytesRead
      if (position > maxBytes) {
        const err = new Error('Файл слишком большой для встроенного редактора')
        err.code = 'SFTP_LIMIT'
        throw err
      }
      chunks.push(Buffer.from(source.subarray(0, bytesRead)))
    }
  } finally {
    await closeHandle(sftp, handle)
  }
  const result = Buffer.concat(chunks)
  return { buffer: result, attrs, version: contentVersion(attrs, result) }
}

function fileVersion(attrs) {
  if (!attrs) return null
  return String(Number(attrs.size) || 0) + ':' + String(Number(attrs.mtime) || 0)
}

function contentVersion(attrs, buffer) {
  return fileVersion(attrs) + ':' + crypto.createHash('sha256').update(buffer).digest('hex')
}

function tempRemotePath(target) {
  const directory = path.posix.dirname(target)
  const base = path.posix.basename(target).slice(0, 120) || 'file'
  return path.posix.join(directory, '.' + base + '.meowshell-' + crypto.randomBytes(8).toString('hex') + '.tmp')
}

async function atomicRemoteWrite(sftp, target, writer, options = {}) {
  const current = await lstatMaybe(sftp, target)
  if (options.expectedVersion != null && fileVersion(current) !== options.expectedVersion) {
    const err = new Error('Удалённый файл изменился после открытия. Перезагрузите его перед сохранением.')
    err.code = 'SFTP_CONFLICT'
    throw err
  }
  if (current && options.overwrite !== true && options.expectedVersion == null) {
    const err = new Error('Удалённый файл уже существует')
    err.code = 'SFTP_EXISTS'
    throw err
  }
  const temporary = tempRemotePath(target)
  let committed = false
  try {
    await writer(temporary)
    const mode = options.mode != null
      ? options.mode
      : (current && Number.isInteger(current.mode) ? current.mode & 0o777 : 0o600)
    await call(sftp, 'chmod', temporary, mode)
    if (current) {
      if (typeof sftp.ext_openssh_rename !== 'function') {
        const err = new Error('Сервер не поддерживает безопасную атомарную замену файла')
        err.code = 'SFTP_NO_ATOMIC_RENAME'
        throw err
      }
      await call(sftp, 'ext_openssh_rename', temporary, target)
    } else {
      await call(sftp, 'rename', temporary, target)
    }
    committed = true
  } finally {
    if (!committed) {
      try { await call(sftp, 'unlink', temporary) } catch {}
    }
  }
  return fileVersion(await call(sftp, 'lstat', target))
}

async function fastPutAtomic(sftp, localPath, remotePath, options = {}) {
  return atomicRemoteWrite(
    sftp,
    remotePath,
    (temporary) => call(sftp, 'fastPut', localPath, temporary, options.fastPut || {}),
    options
  )
}

function localTemporaryPath(target) {
  return path.join(
    path.dirname(target),
    '.' + path.basename(target).slice(0, 120) + '.meowshell-' + crypto.randomBytes(8).toString('hex') + '.tmp'
  )
}

async function fastGetAtomic(sftp, remotePath, target, options = {}) {
  const temporary = localTemporaryPath(target)
  let backup = null
  try {
    if (fs.existsSync(target) && fs.lstatSync(target).isDirectory()) {
      throw new Error('Путь назначения указывает на каталог')
    }
    await call(sftp, 'fastGet', remotePath, temporary, options.fastGet || {})
    try { fs.chmodSync(temporary, options.mode == null ? 0o600 : options.mode) } catch {}
    if (process.platform === 'win32' && fs.existsSync(target)) {
      backup = localTemporaryPath(target) + '.bak'
      fs.renameSync(target, backup)
    }
    try {
      fs.renameSync(temporary, target)
    } catch (err) {
      if (backup) {
        try { fs.renameSync(backup, target) } catch {}
        backup = null
      }
      throw err
    }
    if (backup) {
      try { fs.unlinkSync(backup) } catch {}
      backup = null
    }
  } catch (err) {
    try { fs.unlinkSync(temporary) } catch {}
    if (backup && !fs.existsSync(target)) {
      try { fs.renameSync(backup, target) } catch {}
    }
    throw err
  }
}

async function ensurePrivateDirectory(sftp, remotePath) {
  let attrs = await lstatMaybe(sftp, remotePath)
  if (!attrs) {
    try { await call(sftp, 'mkdir', remotePath, { mode: 0o700 }) } catch (err) {
      attrs = await lstatMaybe(sftp, remotePath)
      if (!attrs) throw err
    }
    attrs = await call(sftp, 'lstat', remotePath)
  }
  if (typeof attrs.isDirectory !== 'function' || !attrs.isDirectory() ||
      (typeof attrs.isSymbolicLink === 'function' && attrs.isSymbolicLink())) {
    throw new Error('Каталог вставки медиа не является безопасным обычным каталогом')
  }
  await call(sftp, 'chmod', remotePath, 0o700)
  const verified = await call(sftp, 'lstat', remotePath)
  if (typeof verified.isDirectory !== 'function' || !verified.isDirectory() ||
      (typeof verified.isSymbolicLink === 'function' && verified.isSymbolicLink()) ||
      !Number.isInteger(verified.mode) || (verified.mode & 0o077) !== 0) {
    throw new Error('Сервер не применил приватные права к каталогу вставки медиа')
  }
}

function getRetryableSftp(session) {
  if (!session || !session.client || typeof session.client.sftp !== 'function') {
    return Promise.reject(new Error('SSH-сессия не поддерживает SFTP'))
  }
  if (!session.sftpPromise) {
    const promise = new Promise((resolve, reject) => {
      try { session.client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))) } catch (err) { reject(err) }
    })
    session.sftpPromise = promise
    promise.then((sftp) => {
      const forget = () => { if (session.sftpPromise === promise) session.sftpPromise = null }
      if (sftp && typeof sftp.once === 'function') {
        sftp.once('close', forget)
        sftp.once('end', forget)
      }
    }, () => {
      if (session.sftpPromise === promise) session.sftpPromise = null
    })
  }
  return session.sftpPromise
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_LIST_BYTES,
  atomicRemoteWrite,
  call,
  contentVersion,
  ensurePrivateDirectory,
  fastGetAtomic,
  fastPutAtomic,
  fileVersion,
  getRetryableSftp,
  lstatMaybe,
  readDirectoryLimited,
  readFileLimited,
}
