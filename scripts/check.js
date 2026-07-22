'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const failures = []
const fail = (message) => failures.push(message)

const files = [
  'src/main/main.js',
  'src/main/preload.js',
  'src/main/utils.js',
  'src/renderer/renderer.js',
  'src/renderer/i18n.js',
  'scripts/ensure-win-pty.js',
]

for (const file of files) {
  const source = read(file)
  try { new vm.Script(source, { filename: file }) } catch (err) { fail(err.message) }
  if (source.includes('\uFFFD')) fail(file + ': найден повреждённый символ U+FFFD')
}

const html = read('src/renderer/index.html')
const htmlDir = path.join(root, 'src', 'renderer')
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const value = match[1]
  if (/^(?:https?:|data:)/.test(value)) continue
  if (!fs.existsSync(path.resolve(htmlDir, value))) fail('Не найден ресурс из index.html: ' + value)
}
if (!/Content-Security-Policy/.test(html)) fail('В index.html отсутствует Content-Security-Policy')

const renderer = read('src/renderer/renderer.js')
const preload = read('src/main/preload.js')
const main = read('src/main/main.js')
const usedApi = new Set([...renderer.matchAll(/window\.api\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
const exposedApi = new Set([...preload.matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
for (const name of usedApi) if (!exposedApi.has(name)) fail('Renderer API не объявлен в preload: ' + name)
for (const name of exposedApi) if (!usedApi.has(name)) fail('Неиспользуемый preload API: ' + name)

const sentChannels = new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]))
const mainChannels = new Set([...main.matchAll(/(?:handleIpc|onIpc)\('([^']+)'/g)].map((m) => m[1]))
for (const channel of sentChannels) if (!mainChannels.has(channel)) fail('Нет main-обработчика IPC: ' + channel)

const pkg = JSON.parse(read('package.json'))
if (!renderer.includes('MeowShell v' + pkg.version)) fail('Версия UI не совпадает с package.json')
if (pkg.license !== 'GPL-3.0-only') fail('package.json должен использовать GPL-3.0-only')
if (!fs.existsSync(path.join(root, 'LICENSE'))) fail('Отсутствует файл LICENSE')

const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage'])
function scanSecrets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) scanSecrets(full)
    else if (entry.isFile() && fs.statSync(full).size <= 5 * 1024 * 1024) {
      const source = fs.readFileSync(full, 'utf8')
      const relative = path.relative(root, full)
      if (/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(source)) fail(relative + ': возможный bot token')
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) fail(relative + ': приватный ключ')
    }
  }
}
scanSecrets(root)

if (failures.length) {
  console.error(failures.map((item) => '✗ ' + item).join('\n'))
  process.exitCode = 1
} else {
  console.log('Статические проверки пройдены: синтаксис, ресурсы, CSP, IPC и версия согласованы.')
}
