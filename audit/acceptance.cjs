'use strict'

// Acceptance checks for the 20 findings in AUDIT.md. These checks use only
// repository source and synthetic data; they never open a real SSH connection,
// read a user profile, or execute terminal commands.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const utils = require('../src/main/utils')

const root = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src/renderer/renderer.js'), 'utf8')
const sftp = fs.readFileSync(path.join(root, 'src/main/sftp-utils.js'), 'utf8')
const pkg = require('../package.json')
const lock = require('../package-lock.json')

const checks = new Map([
  ['A01', () => {
    assert.match(renderer, /routeInput\(binding\.id, data\)/)
    assert.match(renderer, /tab\.binding\.id = res\.id/)
  }],
  ['A02', () => {
    const saved = { id: 'p', host: 'one.test', port: 22, username: 'user', authMode: 'password', password: 'secret' }
    assert.equal(utils.resolveSshConnection({ id: 'p', host: 'two.test', useSavedCredentials: true }, saved).password, '')
    assert.equal(utils.resolveSshConnection({ id: 'p', useSavedCredentials: true }, saved).password, 'secret')
  }],
  ['A03', () => {
    const clean = utils.normalizeConfig({ settings: { snippets: {}, restoreTabs: 'yes', unknown: true } })
    assert.deepEqual(clean.settings.snippets, [])
    assert.equal(clean.settings.restoreTabs, false)
    assert.equal('unknown' in clean.settings, false)
  }],
  ['A04', () => {
    assert.equal(pkg.dependencies['js-yaml'], '4.3.2')
    assert.equal(lock.packages['node_modules/@xmldom/xmldom'].version, '0.8.15')
    assert.equal(lock.packages['node_modules/fast-uri'].version, '3.1.7')
  }],
  ['A05', () => assert.match(main, /ensurePrivateDirectory\(sftp, cache\)/)],
  ['A06', () => {
    assert.match(main, /atomicRemoteWrite\(/)
    assert.match(sftp, /ext_openssh_rename/)
  }],
  ['A07', () => {
    assert.match(main, /client\.on\('end', \(\) => done\(/)
    assert.match(main, /client\.on\('close', \(\) => done\(/)
  }],
  ['A08', () => assert.match(renderer, /if \(tb\.split\) closeSplit\(tb, true\)/)],
  ['A09', () => {
    assert.match(main, /readDirectoryLimited\(sftp, abs\)/)
    assert.match(main, /received > 256 \* 1024/)
  }],
  ['A10', () => assert.match(renderer, /d\.onClose\(\(\) => resolve\(action\)\)/)],
  ['A11', () => assert.match(renderer, /settings\.restoreTabs === true && list\.length/)],
  ['A12', () => assert.match(main, /snippets: \[\]/)],
  ['A13', () => {
    assert.throws(() => utils.formatSshCommand({ host: 'host;echo bad', username: 'root' }))
    assert.match(renderer, /window\.api\.formatSshCommand\(conn\)/)
  }],
  ['A14', () => assert.match(main, /return getRetryableSftp\(s\)/)],
  ['A15', () => {
    const resources = [{ destroyed: false, destroy() { this.destroyed = true } }]
    assert.equal(utils.destroyResources(resources), 1)
    assert.equal(resources[0].destroyed, true)
  }],
  ['A16', () => assert.equal(utils.isDangerousRemoteTarget('child/../'), true)],
  ['A17', () => {
    assert.match(renderer, /document\.addEventListener\('paste'/)
    assert.match(renderer, /if \(text\) safePaste\(id, text, term\)/)
  }],
  ['A18', () => assert.match(renderer, /e\.target\.closest\('\.xterm'\)/)],
  ['A19', () => {
    assert.match(renderer, /await runCiSmoke\(\)/)
    assert.match(renderer, /PTY не вернул контрольную строку/)
  }],
  ['A20', () => {
    assert.match(renderer, /async function saveSettingsChecked/)
    assert.match(renderer, /Туннели не сохранены/)
  }],
])

let failed = 0
for (const [id, check] of checks) {
  try {
    check()
    console.log('PASS', id)
  } catch (err) {
    failed++
    console.error('FAIL', id, '-', err.message)
  }
}

const unit = spawnSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' })
if (unit.status !== 0) failed++

console.log((checks.size - failed) + '/' + checks.size + ' audit findings passed acceptance invariants.')
process.exitCode = failed ? 1 : 0
