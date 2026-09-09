'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const yaml = require('js-yaml')
const { mergeUpdateManifests, prereleaseChannel, writeMergedManifests } = require('../scripts/merge-update-manifests')

const HASH_X64 = Buffer.alloc(64, 1).toString('base64')
const HASH_ARM64 = Buffer.alloc(64, 2).toString('base64')

function manifest(arch, hash, version = '2.3.0-beta.5') {
  return {
    version,
    files: [{ url: 'MeowShell-' + version + '-win-' + arch + '-setup.exe', sha512: hash, size: arch === 'x64' ? 100 : 90 }],
    path: 'MeowShell-' + version + '-win-' + arch + '-setup.exe',
    sha512: hash,
    releaseDate: arch === 'x64' ? '2026-09-10T10:00:00.000Z' : '2026-09-10T10:01:00.000Z',
  }
}

test('architecture manifests are merged into one updater feed', () => {
  const merged = mergeUpdateManifests([manifest('arm64', HASH_ARM64), manifest('x64', HASH_X64)])
  assert.equal(merged.version, '2.3.0-beta.5')
  assert.deepEqual(merged.files.map((file) => file.url), [
    'MeowShell-2.3.0-beta.5-win-x64-setup.exe',
    'MeowShell-2.3.0-beta.5-win-arm64-setup.exe',
  ])
  assert.equal(merged.path, merged.files[0].url)
  assert.equal(merged.releaseDate, '2026-09-10T10:01:00.000Z')
})

test('mixed releases and unsafe installer metadata are rejected', () => {
  assert.throws(
    () => mergeUpdateManifests([manifest('x64', HASH_X64), manifest('arm64', HASH_ARM64, '2.3.0-beta.6')]),
    /different versions/
  )
  const unsafe = manifest('arm64', HASH_ARM64)
  unsafe.files[0].url = '../MeowShell-2.3.0-beta.5-win-arm64-setup.exe'
  assert.throws(() => mergeUpdateManifests([manifest('x64', HASH_X64), unsafe]), /Invalid arm64 installer metadata/)
  const invalidHash = manifest('arm64', 'not-a-hash')
  assert.throws(() => mergeUpdateManifests([manifest('x64', HASH_X64), invalidHash]), /Invalid arm64 installer metadata/)
})

test('writer creates latest and matching prerelease channel manifests', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meowshell-manifest-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const x64 = path.join(directory, 'latest-x64.yml')
  const arm64 = path.join(directory, 'latest-arm64.yml')
  const latest = path.join(directory, 'latest.yml')
  fs.writeFileSync(x64, yaml.dump(manifest('x64', HASH_X64)))
  fs.writeFileSync(arm64, yaml.dump(manifest('arm64', HASH_ARM64)))
  const result = writeMergedManifests([x64, arm64], latest)
  assert.equal(result.channel, 'beta')
  assert.deepEqual(yaml.load(fs.readFileSync(latest, 'utf8')), yaml.load(fs.readFileSync(path.join(directory, 'beta.yml'), 'utf8')))
  assert.equal(prereleaseChannel('3.0.0'), 'latest')
  assert.equal(prereleaseChannel('3.0.0-rc.1'), 'rc')
})
