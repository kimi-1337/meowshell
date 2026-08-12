'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const {
  isDangerousRemoteTarget,
  normalizeConfig,
  normalizeRemotePath,
  quotePathForShell,
  quotePosix,
  resolveLocalChild,
  safeEntryName,
  safeRemoteEntryName,
  validPort,
} = require('../src/main/utils')

test('normalizeConfig восстанавливает безопасную структуру', () => {
  assert.deepEqual(normalizeConfig(null), { connections: [], settings: {}, knownHosts: {} })
  assert.deepEqual(normalizeConfig({ connections: 'bad', settings: [], knownHosts: null }), {
    connections: [], settings: {}, knownHosts: {},
  })
  const polluted = JSON.parse('{"settings":{"__proto__":{"admin":true},"theme":"dark"}}')
  assert.deepEqual(normalizeConfig(polluted).settings, { theme: 'dark' })
  assert.equal({}.admin, undefined)

  let nested = { value: true }
  for (let i = 0; i < 40; i++) nested = { nested }
  assert.throws(() => normalizeConfig({ settings: nested }), /слишком большую глубину/)
})

test('safeEntryName запрещает обход директорий', () => {
  assert.equal(safeEntryName('report.txt'), 'report.txt')
  for (const value of ['', '.', '..', '../secret', 'a/b', 'a\\b', 'bad\0name', 'CON', 'bad:name', 'trail.']) {
    assert.throws(() => safeEntryName(value), /небезопасное имя/)
  }
})

test('resolveLocalChild всегда оставляет файл внутри каталога', () => {
  const base = path.resolve('/tmp', 'meowshell-test-target')
  assert.equal(resolveLocalChild(base, 'file.txt'), path.join(base, 'file.txt'))
  assert.throws(() => resolveLocalChild(base, '..'))
})

test('удалённые SFTP-пути нормализуются и защищают корень', () => {
  assert.equal(safeRemoteEntryName('отчёт:2026.txt'), 'отчёт:2026.txt')
  for (const value of ['', '.', '..', '../secret', 'a/b', 'bad\0name']) {
    assert.throws(() => safeRemoteEntryName(value), /Небезопасное имя/)
  }
  assert.equal(normalizeRemotePath('/srv/app/../logs'), '/srv/logs')
  assert.equal(isDangerousRemoteTarget('/srv/..'), true)
  assert.equal(isDangerousRemoteTarget('/./'), true)
  assert.equal(isDangerousRemoteTarget('../private'), true)
  assert.equal(isDangerousRemoteTarget('/srv/data'), false)
})

test('пути экранируются для POSIX и PowerShell', () => {
  assert.equal(quotePosix("a'b"), "'a'\\''b'")
  assert.equal(quotePathForShell("a'b", 'pwsh.exe'), "'a''b'")
  assert.equal(quotePathForShell('/tmp/a b', '/bin/bash'), "'/tmp/a b'")
})

test('validPort принимает только диапазон TCP-портов', () => {
  assert.equal(validPort('22'), 22)
  assert.equal(validPort(65535), 65535)
  assert.equal(validPort(0), null)
  assert.equal(validPort(70000, 22), 22)
})
