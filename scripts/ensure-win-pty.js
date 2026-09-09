'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const optionalDependencies = require(path.join(root, 'node_modules', '@lydell', 'node-pty', 'package.json'))
  .optionalDependencies
const lockfile = require(path.join(root, 'package-lock.json'))
const packageNames = ['@lydell/node-pty-win32-x64', '@lydell/node-pty-win32-arm64']

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(command + ' завершился с кодом ' + result.status)
}

function runNpm(args) {
  if (process.env.npm_execpath) {
    run(process.execPath, [process.env.npm_execpath, ...args])
    return
  }
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args)
}

for (const packageName of packageNames) {
  const version = optionalDependencies[packageName]
  if (!version) throw new Error('Не найдена версия ' + packageName + ' в @lydell/node-pty')
  const locked = lockfile.packages && lockfile.packages['node_modules/' + packageName]
  if (!locked || locked.version !== version || typeof locked.integrity !== 'string') {
    throw new Error('В package-lock.json нет точной integrity-записи для ' + packageName + '@' + version)
  }
  const target = path.join(root, 'node_modules', ...packageName.split('/'))

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meowshell-win-pty-'))
  try {
    runNpm(['pack', packageName + '@' + version, '--pack-destination', temp])
    const archive = fs.readdirSync(temp).find((name) => name.endsWith('.tgz'))
    if (!archive) throw new Error('npm pack did not create an archive for ' + packageName)
    const archivePath = path.join(temp, archive)
    const actualIntegrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(archivePath)).digest('base64')
    if (actualIntegrity !== locked.integrity) {
      throw new Error('Integrity mismatch for ' + packageName + '@' + version)
    }
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(target, { recursive: true })
    run('tar', ['-xzf', archivePath, '-C', target, '--strip-components=1'])
    const installed = require(path.join(target, 'package.json'))
    if (installed.name !== packageName || installed.version !== version) {
      throw new Error('Unexpected Windows PTY package was installed')
    }
    console.log('Installed ' + packageName + '@' + version + ' for cross-compilation')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
