'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const {
  isDangerousRemoteTarget,
  destroyResources,
  formatSshCommand,
  normalizeConfig,
  normalizeRemotePath,
  quotePathForShell,
  quotePosix,
  resolveLocalChild,
  resolveSshConnection,
  safeEntryName,
  safeRemoteEntryName,
  sanitizeConnection,
  sanitizeSettings,
  validPort,
  validSshEndpoint,
} = require('../src/main/utils')

test('normalizeConfig восстанавливает безопасную структуру', () => {
  const defaults = { snippets: [], lastTabs: [], customThemes: {}, restoreTabs: false }
  assert.deepEqual(normalizeConfig(null), { connections: [], settings: defaults, knownHosts: {} })
  assert.deepEqual(normalizeConfig({ connections: 'bad', settings: [], knownHosts: null }), {
    connections: [], settings: defaults, knownHosts: {},
  })
  const polluted = JSON.parse('{"settings":{"__proto__":{"admin":true},"theme":"dark"}}')
  assert.deepEqual(normalizeConfig(polluted).settings, Object.assign({ theme: 'dark' }, defaults))
  assert.equal({}.admin, undefined)

  assert.doesNotThrow(() => normalizeConfig({ settings: { ignored: { deeply: { nested: true } } } }))
})

test('схема настроек отбрасывает неизвестные и неправильные значения', () => {
  assert.deepEqual(sanitizeSettings({
    fontSize: 'huge',
    theme: 42,
    restoreTabs: 'yes',
    language: 'xx',
    snippets: [{ name: 'ok', cmd: 'echo ok' }, { name: '', cmd: 'secret' }, null],
    lastTabs: [{ type: 'ssh', connId: 'abc' }, { type: 'ssh' }, { type: 'bad' }],
    unknown: { value: true },
  }), {
    snippets: [{ name: 'ok', cmd: 'echo ok', enter: true }],
    lastTabs: [{ type: 'ssh', connId: 'abc' }],
    customThemes: {},
    restoreTabs: false,
  })
})

test('настройки панели инструментов нормализуют порядок и скрытые кнопки', () => {
  const result = sanitizeSettings({
    toolbarOrder: ['sftp', 'split', 'sftp', 'unknown'],
    hiddenToolbarItems: ['monitor', 'unknown', 'monitor'],
    showSnippetsBar: false,
  })
  assert.deepEqual(result.toolbarOrder, ['sftp', 'split', 'broadcast', 'monitor', 'tunnels'])
  assert.deepEqual(result.hiddenToolbarItems, ['monitor'])
  assert.equal(result.showSnippetsBar, false)
})

test('SSH-профиль хранит секрет только активного способа входа', () => {
  assert.deepEqual(sanitizeConnection({
    id: 'one', host: 'example.org', port: 22, username: 'meow', authMode: 'key',
    keyPath: '/keys/id', password: 'must-drop', passphrase: 'keep',
  }), {
    id: 'one', name: '', host: 'example.org', port: 22, username: 'meow', authMode: 'key',
    keyPath: '/keys/id', tunnels: [], password: '', passphrase: 'keep',
  })
  assert.equal(sanitizeConnection({ host: '-oProxyCommand=bad', username: 'root' }), null)
})

test('сохранённые SSH-секреты привязаны к endpoint, auth mode и ключу', () => {
  const saved = {
    id: 'one', host: 'original.test', port: 22, username: 'meow', authMode: 'password',
    keyPath: '', password: 'enc:password', passphrase: '',
  }
  const decrypt = (value) => value.replace(/^enc:/, '')
  assert.equal(resolveSshConnection({ id: 'one', useSavedCredentials: true }, saved, decrypt).password, 'password')
  assert.equal(resolveSshConnection({ id: 'one', host: 'other.test', useSavedCredentials: true }, saved, decrypt).password, '')
  assert.equal(resolveSshConnection({ id: 'one', authMode: 'key', keyPath: '/other', useSavedCredentials: true }, saved, decrypt).password, '')

  const keySaved = Object.assign({}, saved, { authMode: 'key', keyPath: '/id', password: '', passphrase: 'enc:phrase' })
  assert.equal(resolveSshConnection({ id: 'one', authMode: 'key', keyPath: '/id', useSavedCredentials: true }, keySaved, decrypt).passphrase, 'phrase')
  assert.equal(resolveSshConnection({ id: 'one', authMode: 'key', keyPath: '/different', useSavedCredentials: true }, keySaved, decrypt).passphrase, '')
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
  assert.equal(quotePathForShell('C:\\safe path\\file.txt', 'cmd.exe'), '"C:\\safe path\\file.txt"')
  assert.throws(() => quotePathForShell('C:\\%TEMP%\\secret', 'cmd.exe'), /нельзя безопасно/)
})

test('SSH-команда форматируется только из безопасного endpoint', () => {
  assert.equal(validSshEndpoint('2001:db8::1', 'deploy'), true)
  assert.equal(formatSshCommand({ host: '2001:db8::1', username: 'deploy', port: 2202 }), 'ssh deploy@[2001:db8::1] -p 2202')
  assert.throws(() => formatSshCommand({ host: 'host; calc', username: 'root' }), /Некорректный/)
})

test('validPort принимает только диапазон TCP-портов', () => {
  assert.equal(validPort('22'), 22)
  assert.equal(validPort(65535), 65535)
  assert.equal(validPort(0), null)
  assert.equal(validPort(70000, 22), 22)
})

test('остановка владельца уничтожает все активные socket/stream ресурсы', () => {
  const calls = []
  const resources = new Set([
    { destroy: () => calls.push('socket') },
    { destroy: () => calls.push('stream') },
  ])
  assert.equal(destroyResources(resources), 2)
  assert.deepEqual(calls, ['socket', 'stream'])
})
