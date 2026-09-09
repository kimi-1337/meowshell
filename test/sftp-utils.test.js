'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  atomicRemoteWrite,
  ensurePrivateDirectory,
  getRetryableSftp,
  readDirectoryLimited,
  readFileLimited,
} = require('../src/main/sftp-utils')

function attrs(buffer, mode = 0o100600) {
  return {
    size: buffer.length,
    mtime: 100,
    mode,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  }
}

function memorySftp(initial = {}) {
  const files = new Map(Object.entries(initial).map(([name, value]) => [name, Buffer.from(value)]))
  const handles = new Map()
  let nextHandle = 1
  return {
    files,
    lstat(name, cb) {
      const value = files.get(name)
      if (!value) return cb(Object.assign(new Error('missing'), { code: 2 }))
      cb(null, attrs(value))
    },
    writeFile(name, value, cb) { files.set(name, Buffer.from(value)); cb(null) },
    chmod(name, mode, cb) { files.has(name) ? cb(null) : cb(new Error('missing')) },
    rename(from, to, cb) {
      if (!files.has(from)) return cb(new Error('missing'))
      files.set(to, files.get(from)); files.delete(from); cb(null)
    },
    ext_openssh_rename(from, to, cb) { this.rename(from, to, cb) },
    unlink(name, cb) { files.delete(name); cb(null) },
    open(name, flags, cb) {
      if (!files.has(name)) return cb(new Error('missing'))
      const handle = Buffer.from(String(nextHandle++))
      handles.set(handle.toString(), name)
      cb(null, handle)
    },
    read(handle, buffer, offset, length, position, cb) {
      const source = files.get(handles.get(handle.toString()))
      if (position >= source.length) return cb(Object.assign(new Error('eof'), { code: 1 }))
      const count = Math.min(length, source.length - position)
      source.copy(buffer, offset, position, position + count)
      cb(null, count, buffer, position)
    },
    close(handle, cb) { handles.delete(handle.toString()); cb(null) },
  }
}

test('атомарная запись SFTP сохраняет исходник при ошибке commit', async () => {
  const sftp = memorySftp({ '/data.txt': 'old' })
  sftp.ext_openssh_rename = (from, to, cb) => cb(new Error('rename denied'))
  await assert.rejects(
    atomicRemoteWrite(
      sftp,
      '/data.txt',
      (temporary) => new Promise((resolve) => sftp.writeFile(temporary, 'new', resolve)),
      { overwrite: true }
    ),
    /rename denied/
  )
  assert.equal(sftp.files.get('/data.txt').toString(), 'old')
  assert.equal([...sftp.files.keys()].some((name) => name.includes('.meowshell-')), false)
})

test('атомарная запись SFTP заменяет файл только после готовности временного', async () => {
  const sftp = memorySftp({ '/data.txt': 'old' })
  const version = await atomicRemoteWrite(
    sftp,
    '/data.txt',
    (temporary) => new Promise((resolve) => sftp.writeFile(temporary, 'new value', resolve)),
    { overwrite: true }
  )
  assert.equal(sftp.files.get('/data.txt').toString(), 'new value')
  assert.match(version, /^9:100$/)
})

test('ограниченный reader не доверяет размеру из предварительного stat', async () => {
  const sftp = memorySftp({ '/growing.txt': '123456789' })
  const original = sftp.lstat
  sftp.lstat = (name, cb) => original.call(sftp, name, (err, value) => {
    if (!err) value.size = 1
    cb(err, value)
  })
  await assert.rejects(readFileLimited(sftp, '/growing.txt', 4), /слишком большой/)
})

test('листинг каталога останавливается на фактическом лимите и закрывает handle', async () => {
  let closed = false
  const sftp = {
    opendir(path, cb) { cb(null, Buffer.from('dir')) },
    readdir(handle, cb) {
      cb(null, [
        { filename: 'one', longname: 'one', attrs: {} },
        { filename: 'two', longname: 'two', attrs: {} },
      ])
    },
    close(handle, cb) { closed = true; cb(null) },
  }
  await assert.rejects(readDirectoryLimited(sftp, '/', { maxEntries: 1 }), /слишком большой/)
  assert.equal(closed, true)
})

test('каталог paste-media обязан принять и подтвердить приватные права', async () => {
  let mode = 0o40755
  const directoryAttrs = () => ({
    mode,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  })
  const sftp = {
    lstat(path, cb) { cb(null, directoryAttrs()) },
    chmod(path, requested, cb) { mode = 0o40755; cb(null) },
  }
  await assert.rejects(ensurePrivateDirectory(sftp, '/home/meow/.meowshell'), /не применил приватные права/)
})

test('каталог paste-media обязан быть подтверждён обычным каталогом', async () => {
  const sftp = {
    lstat(path, cb) { cb(null, { mode: 0o100600 }) },
    chmod(path, requested, cb) { cb(null) },
  }
  await assert.rejects(ensurePrivateDirectory(sftp, '/home/meow/.meowshell'), /обычным каталогом/)
})

test('временная ошибка открытия SFTP не блокирует повторную попытку', async () => {
  let calls = 0
  const channel = { once() {} }
  const session = { client: { sftp(callback) {
    calls++
    if (calls === 1) callback(new Error('temporary failure'))
    else callback(null, channel)
  } } }
  await assert.rejects(getRetryableSftp(session), /temporary failure/)
  assert.equal(await getRetryableSftp(session), channel)
  assert.equal(calls, 2)
})
