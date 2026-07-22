'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const optionalDependencies = require(path.join(root, 'node_modules', '@lydell', 'node-pty', 'package.json'))
  .optionalDependencies
const packageNames = ['@lydell/node-pty-win32-x64', '@lydell/node-pty-win32-arm64']

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(command + ' завершился с кодом ' + result.status)
}

for (const packageName of packageNames) {
  const version = optionalDependencies[packageName]
  if (!version) throw new Error('Не найдена версия ' + packageName + ' в @lydell/node-pty')
  const target = path.join(root, 'node_modules', ...packageName.split('/'))
  try {
    if (require(path.join(target, 'package.json')).version === version) {
      console.log(packageName + '@' + version + ' is already installed')
      continue
    }
  } catch {}

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meowshell-win-pty-'))
  try {
    run(npmCommand, ['pack', packageName + '@' + version, '--pack-destination', temp])
    const archive = fs.readdirSync(temp).find((name) => name.endsWith('.tgz'))
    if (!archive) throw new Error('npm pack did not create an archive for ' + packageName)
    fs.mkdirSync(target, { recursive: true })
    run('tar', ['-xzf', path.join(temp, archive), '-C', target, '--strip-components=1'])
    const installed = require(path.join(target, 'package.json'))
    if (installed.name !== packageName || installed.version !== version) {
      throw new Error('Unexpected Windows PTY package was installed')
    }
    console.log('Installed ' + packageName + '@' + version + ' for cross-compilation')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
