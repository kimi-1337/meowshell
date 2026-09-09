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
  'src/main/sftp-utils.js',
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
const onboarding = renderer.match(/function showOnboarding\(\)[\s\S]*?\n}\n/)
if (!onboarding) fail('Не найдена реализация first-run onboarding')
else {
  if (!onboarding[0].includes("d.m.querySelectorAll('[data-action]')")) {
    fail('Кнопки onboarding должны привязываться к DOM-элементу d.m')
  }
  if (!onboarding[0].includes('d.close()')) fail('Диалог onboarding должен закрываться через d.close()')
}
if (renderer.includes("d.querySelector('.confirm-text')") || renderer.includes("d.querySelectorAll('[data-mode]')")) {
  fail('Диалог импорта должен обращаться к DOM-элементу d.m')
}
if (!renderer.includes("d.m.querySelector('.confirm-text')") || !renderer.includes("d.m.querySelectorAll('[data-mode]')") ||
    !renderer.includes('animateTerminalText(term, \'input\'') || !renderer.includes('animateTerminalText(term, \'output\'')) {
  fail('Импорт конфигурации и плавная анимация ввода/вывода не прошли регрессионную проверку')
}
if (!main.includes('isDangerousRemoteTarget(p)') || !main.includes('safeRemoteEntryName(item && item.filename)')) {
  fail('Опасные SFTP-цели и имена должны проверяться в main process')
}
for (const [needle, message] of [
  ['routeInput(binding.id, data)', 'Ввод терминала должен использовать изменяемую привязку сессии'],
  ["document.addEventListener('paste'", 'Нативная вставка должна проходить через pasteGuard'],
  ["settings.restoreTabs === true", 'Восстановление вкладок должно быть явным opt-in'],
  ['d.onClose(() => resolve(action))', 'Закрытие onboarding должно завершать startup promise'],
  ['saveSettingsChecked', 'Ошибки сохранения настроек должны обрабатываться в renderer'],
  ['runCiSmoke()', 'Smoke-проверка должна запускать локальный PTY'],
]) {
  if (!renderer.includes(needle)) fail(message)
}
for (const [needle, message] of [
  ['readDirectoryLimited(sftp, abs)', 'SFTP listing должен иметь фактический лимит данных'],
  ['ensurePrivateDirectory(sftp, cache)', 'Paste-media должен проверять приватность удалённого каталога'],
  ["reason: exitCode !== null || exitSignal ? 'exit' : 'disconnect'", 'SSH exit и disconnect должны различаться'],
  ["handleIpc('ssh:format-command'", 'SSH-команда должна форматироваться в main process'],
]) {
  if (!main.includes(needle)) fail(message)
}
const wheelHandler = renderer.match(/let altWheelAcc = 0[\s\S]*?term\.onBell/)
if (!wheelHandler) fail('Не найден обработчик колёсика полноэкранных программ')
else {
  if (!wheelHandler[0].includes("settings.altWheel || 'page'")) {
    fail('Безопасным режимом колёсика должен быть PageUp/PageDown')
  }
  if (!wheelHandler[0].includes("'\\x1b[5~'") || !wheelHandler[0].includes("'\\x1b[6~'")) {
    fail('Обработчик колёсика должен отправлять PageUp/PageDown вместо стрелок')
  }
  if (!wheelHandler[0].includes("mouseTrackingMode !== 'none'")) {
    fail('Программы с mouse tracking должны получать нативные wheel-события')
  }
}
const usedApi = new Set([...renderer.matchAll(/window\.api\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
const exposedApi = new Set([...preload.matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]))
for (const name of usedApi) if (!exposedApi.has(name)) fail('Renderer API не объявлен в preload: ' + name)
for (const name of exposedApi) if (!usedApi.has(name)) fail('Неиспользуемый preload API: ' + name)

const sentChannels = new Set([...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]))
const mainChannels = new Set([...main.matchAll(/(?:handleIpc|onIpc)\('([^']+)'/g)].map((m) => m[1]))
for (const channel of sentChannels) if (!mainChannels.has(channel)) fail('Нет main-обработчика IPC: ' + channel)

const pkg = JSON.parse(read('package.json'))
if (!renderer.includes('MeowShell v' + pkg.version)) fail('Версия UI не совпадает с package.json')
for (const file of ['README.md', 'README.ru.md', 'CHANGELOG.md']) {
  if (!read(file).includes(pkg.version)) fail(file + ': версия не совпадает с package.json')
}
if (pkg.license !== 'GPL-3.0-only') fail('package.json должен использовать GPL-3.0-only')
if (!fs.existsSync(path.join(root, 'LICENSE'))) fail('Отсутствует файл LICENSE')

for (const file of fs.readdirSync(path.join(root, '.github', 'workflows')).filter((name) => /\.ya?ml$/i.test(name))) {
  const source = read(path.join('.github', 'workflows', file))
  for (const match of source.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([^\s#]+)/g)) {
    if (!/^[a-f0-9]{40}$/.test(match[2])) fail(file + ': GitHub Action не закреплён полным commit SHA: ' + match[1])
  }
  if (/npm audit[^\n]*--omit=dev/.test(source)) fail(file + ': аудит не должен скрывать Electron из devDependencies')
}

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
