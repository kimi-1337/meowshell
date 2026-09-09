/* global Terminal, FitAddon, WebLinksAddon, SearchAddon, Unicode11Addon */
'use strict'

const $ = (s) => document.querySelector(s)
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch])
const uiText = (english, russian) => window.MeowI18n && window.MeowI18n.language() === 'ru' ? russian : english

// ---------- темы ----------

const THEMES = {
  dark: {
    label: 'GitHub Dark',
    xterm: {
      background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0d1117',
      selectionBackground: 'rgba(88,166,255,0.35)',
      black: '#161b22', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
      brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
    },
  },
  dracula: {
    label: 'Dracula',
    xterm: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9', cursorAccent: '#282a36',
      selectionBackground: 'rgba(189,147,249,0.35)',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },
  onedark: {
    label: 'One Dark',
    xterm: {
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34',
      selectionBackground: 'rgba(97,175,239,0.35)',
      black: '#1e2127', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
      brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
    },
  },
  nord: {
    label: 'Nord',
    xterm: {
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440',
      selectionBackground: 'rgba(136,192,208,0.35)',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
  },
  light: {
    label: 'Светлая',
    xterm: {
      background: '#ffffff', foreground: '#1f2328', cursor: '#0969da', cursorAccent: '#ffffff',
      selectionBackground: 'rgba(9,105,218,0.25)',
      black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
      blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
      brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
    },
  },
}

// ---------- состояние ----------

let settings = {
  language: 'auto',
  theme: 'dark',
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Courier New', 'Segoe UI Emoji', 'Segoe UI Symbol', monospace",
  shell: 'cmd.exe',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  altWheel: 'page',
  copyOnSelect: true,
  smoothCursor: true,
  smoothTextAnimation: true,
  webglRenderer: false,
  typingFx: 'glow',
  lineHeight: 1.0,
  letterSpacing: 0,
  autoReconnect: true,
  bgImage: '',
  bgDim: 40,
  bgBlur: 0,
  quakeEnabled: false,
  snippets: [],
}
let connections = []
const tabs = new Map() // id -> { id, type, title, term, fit, tabEl, paneEl, sftpPath, split? }
const paneOf = new Map() // sessionId -> { tab, slot: 'main' | 'split' }
let activeId = null
let focusedSessId = null
let lastSshSessionId = null
let editingConnId = null
let toastTimer = null
let rendererSafeMode = false
let rendererSmokeTest = false
let rendererPlatform = ''
let currentAppVersion = ''
let updateState = { supported: false, status: 'unsupported', currentVersion: '' }
let dismissedUpdateKey = ''
let settingsSaveQueue = Promise.resolve()

// ---------- утилиты ----------

function toast(msg, isError) {
  const el = $('#toast')
  el.textContent = window.MeowI18n ? window.MeowI18n.tr(msg) : msg
  el.classList.toggle('error', !!isError)
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000)
}

async function saveSettingsChecked(options = {}) {
  let payload
  try { payload = JSON.parse(JSON.stringify(settings)) } catch (err) {
    if (!options.silent) toast('Не удалось подготовить настройки к сохранению: ' + err.message, true)
    return false
  }
  const operation = settingsSaveQueue.catch(() => null).then(() => window.api.saveSettings(payload))
  settingsSaveQueue = operation
  try {
    const result = await operation
    if (!result || result.error) throw new Error(result && result.error || 'пустой ответ приложения')
    return true
  } catch (err) {
    if (!options.silent) toast('Настройки не сохранены: ' + (err && err.message ? err.message : err), true)
    return false
  }
}

function fmtSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function updateKey(state) {
  return String(state.version || state.currentVersion || '') + ':' + String(state.status || '')
}

function updateStatusText(state) {
  const version = state.version ? ' ' + state.version : ''
  switch (state.status) {
    case 'checking': return uiText('Checking for updates…', 'Проверяем обновления…')
    case 'available': return uiText('Version' + version + ' is ready to download', 'Версия' + version + ' готова к скачиванию')
    case 'downloading': return uiText('Downloading' + version + ': ' + Math.round(state.percent || 0) + '%', 'Скачиваем' + version + ': ' + Math.round(state.percent || 0) + '%')
    case 'downloaded': return uiText('Version' + version + ' is downloaded and ready to install', 'Версия' + version + ' скачана и готова к установке')
    case 'installing': return uiText('Installing the update…', 'Устанавливаем обновление…')
    case 'up-to-date': return uiText('You have the latest version', 'Установлена последняя версия')
    case 'error': return uiText('Update error: ', 'Ошибка обновления: ') + (state.error || uiText('unknown error', 'неизвестная ошибка'))
    case 'idle': return uiText('Automatic update checks are enabled', 'Автоматическая проверка обновлений включена')
    default: return uiText('Updates are available in an installed Windows build', 'Обновления доступны в установленной версии для Windows')
  }
}

function renderUpdateSettings() {
  const status = document.querySelector('#st-update-status')
  const button = document.querySelector('#st-update-check')
  const version = document.querySelector('#st-app-version')
  if (status) status.textContent = updateStatusText(updateState)
  if (version) version.textContent = 'MeowShell v' + (currentAppVersion || updateState.currentVersion || '—') + ' · Electron + xterm.js'
  if (!button) return
  button.disabled = !updateState.supported || ['checking', 'downloading', 'downloaded', 'installing'].includes(updateState.status)
  button.textContent = updateState.status === 'checking'
    ? uiText('Checking…', 'Проверяем…')
    : uiText('Check', 'Проверить')
}

function renderUpdateState(nextState) {
  if (!nextState || typeof nextState !== 'object') return
  updateState = Object.assign({}, updateState, nextState)
  const banner = $('#update-banner')
  const status = String(updateState.status || 'idle')
  const visible = updateState.supported && (
    ['available', 'downloading', 'downloaded', 'installing'].includes(status) ||
    (updateState.manual && ['checking', 'up-to-date', 'error'].includes(status))
  ) && dismissedUpdateKey !== updateKey(updateState)
  banner.classList.toggle('hidden', !visible)
  banner.dataset.status = status

  const version = updateState.version ? ' ' + updateState.version : ''
  const title = $('#update-title')
  const detail = $('#update-detail')
  const action = $('#update-action')
  const progress = $('#update-progress')
  const fill = $('#update-progress-fill')
  let actionKind = ''
  title.textContent = updateStatusText(updateState)
  detail.textContent = ''

  if (status === 'available') {
    title.textContent = uiText('A new MeowShell version is available', 'Доступно новое обновление MeowShell')
    detail.textContent = uiText('Version' + version + '. Download it without leaving the terminal.', 'Версия' + version + '. Скачай её, не выходя из терминала.')
    action.textContent = uiText('Download', 'Скачать')
    actionKind = 'download'
  } else if (status === 'downloading') {
    title.textContent = uiText('Downloading MeowShell' + version, 'Скачиваем MeowShell' + version)
    const parts = []
    if (updateState.total) parts.push(fmtSize(updateState.transferred || 0) + ' / ' + fmtSize(updateState.total))
    if (updateState.bytesPerSecond) parts.push(fmtSize(updateState.bytesPerSecond) + '/s')
    detail.textContent = parts.join(' · ') || uiText('The installer is downloaded securely in the background', 'Установщик безопасно скачивается в фоне')
  } else if (status === 'downloaded') {
    title.textContent = uiText('The update is ready to install', 'Обновление готово к установке')
    detail.textContent = uiText('Version' + version + '. MeowShell will restart; open sessions will close.', 'Версия' + version + '. MeowShell перезапустится, открытые сессии закроются.')
    action.textContent = uiText('Install and restart', 'Установить и перезапустить')
    actionKind = 'install'
  } else if (status === 'installing') {
    detail.textContent = uiText('Closing MeowShell and starting the verified installer…', 'Закрываем MeowShell и запускаем проверенный установщик…')
  } else if (status === 'checking') {
    detail.textContent = uiText('This usually takes a few seconds.', 'Обычно это занимает несколько секунд.')
  } else if (status === 'up-to-date') {
    detail.textContent = uiText('Current version: ', 'Текущая версия: ') + (updateState.currentVersion || currentAppVersion || '—')
  } else if (status === 'error') {
    title.textContent = uiText('Could not update MeowShell', 'Не удалось обновить MeowShell')
    detail.textContent = updateState.error || uiText('Check the internet connection and try again.', 'Проверь подключение к интернету и повтори попытку.')
    action.textContent = uiText('Retry', 'Повторить')
    actionKind = 'check'
  }

  action.dataset.action = actionKind
  action.classList.toggle('hidden', !actionKind)
  action.disabled = false
  const showProgress = status === 'downloading' || status === 'downloaded'
  progress.classList.toggle('hidden', !showProgress)
  fill.style.width = Math.max(0, Math.min(100, status === 'downloaded' ? 100 : Number(updateState.percent) || 0)) + '%'
  renderUpdateSettings()
}

$('#update-action').addEventListener('click', async () => {
  const action = $('#update-action').dataset.action
  $('#update-action').disabled = true
  try {
    let state
    if (action === 'download') state = await window.api.downloadUpdate()
    else if (action === 'install') state = await window.api.installUpdate()
    else if (action === 'check') state = await window.api.checkForUpdates()
    if (state) renderUpdateState(state)
  } catch (err) {
    toast(uiText('Update error: ', 'Ошибка обновления: ') + (err && err.message ? err.message : err), true)
  } finally {
    $('#update-action').disabled = false
  }
})

$('#update-dismiss').addEventListener('click', () => {
  dismissedUpdateKey = updateKey(updateState)
  $('#update-banner').classList.add('hidden')
})

window.api.onUpdateState((state) => renderUpdateState(state))

function fitTab(tab) {
  if (!tab || !tab.fit || tab.paneEl.classList.contains('hidden')) return
  try {
    tab.fit.fit()
    window.api.resize(tab.id, tab.term.cols, tab.term.rows)
  } catch {}
  if (tab.split) {
    try {
      tab.split.fit.fit()
      window.api.resize(tab.split.id, tab.split.term.cols, tab.split.term.rows)
    } catch {}
  }
}

function updateEmptyState() {
  $('#empty-state').classList.toggle('hidden', tabs.size > 0)
}

// ---------- вкладки ----------

// Создаёт терминал в ячейке (основной или сплит)
function makeTerm(sessId, tab, slot, cellEl) {
  const binding = { id: sessId }
  cellEl.dataset.sessionId = sessId
  const th = THEMES[settings.theme] || THEMES.dark
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorStyle,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    theme: xtermTheme(),
    allowTransparency: false,
    scrollback: settings.scrollback,
    lineHeight: settings.lineHeight || 1,
    letterSpacing: settings.letterSpacing || 0,
  })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()) } catch {}
  let search = null
  try {
    search = new SearchAddon.SearchAddon()
    term.loadAddon(search)
  } catch {}
  // Unicode 11: правильная ширина эмодзи и спецсимволов (спиннеры CLI и т.п.)
  try {
    term.loadAddon(new Unicode11Addon.Unicode11Addon())
    term.unicode.activeVersion = '11'
  } catch {}
  term.open(cellEl)
  // GPU-рендеринг (WebGL) — убирает артефакты и тормоза в тяжёлых CLI
  if (settings.webglRenderer === true && !rendererSafeMode) {
    try {
      if (typeof WebglAddon !== 'undefined') {
        const webgl = new WebglAddon.WebglAddon()
        webgl.onContextLoss(() => { try { webgl.dispose() } catch {} })
        term.loadAddon(webgl)
      }
    } catch {}
  }
  term.onData((data) => {
    routeInput(binding.id, data)
    animateTerminalText(term, 'input', data.length)
    typingFx(term)
  })
  // плавная анимация курсора
  attachSmoothCursor(term)
  // копирование по выделению
  term.onSelectionChange(() => {
    if (settings.copyOnSelect && term.hasSelection()) {
      copyText(term.getSelection())
    }
  })
  // v2.1: Ctrl+C копирует выделение (если оно есть), иначе как обычно шлёт прерывание.
  // Ctrl+Shift+C копирует всегда.
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const isC = ev.code === 'KeyC' && !ev.altKey && !ev.metaKey
    if (isC && ev.ctrlKey && ev.shiftKey) {
      if (term.hasSelection()) { copyText(term.getSelection()); toast('Скопировано') }
      return false
    }
    if (isC && ev.ctrlKey && !ev.shiftKey && settings.ctrlCCopy !== false && term.hasSelection()) {
      copyText(term.getSelection())
      term.clearSelection()
      toast('Скопировано')
      return false
    }
    return true
  })
  // Колёсико в полноэкранных программах (Claude Code, Codex, vim, htop и т.п.).
  // Если приложение включило mouse tracking, xterm передаст ему настоящее wheel-событие.
  // Иначе безопасный режим использует PageUp/PageDown: стрелки в Claude/Codex меняют
  // историю ввода вместо прокрутки диалога.
  let altWheelAcc = 0
  if (term.attachCustomWheelEventHandler) {
    term.attachCustomWheelEventHandler((ev) => {
      try {
        if (term.buffer.active.type !== 'alternate') return true // обычная история — скроллим как всегда
        if (term.modes && term.modes.mouseTrackingMode && term.modes.mouseTrackingMode !== 'none') return true // программа сама обрабатывает мышь
        if (!ev.deltaY || ev.shiftKey) return true
        const mode = settings.altWheel || 'page'
        if (mode === 'xterm') return true // старое поведение
        if (mode === 'off') {
          ev.preventDefault()
          return false // вообще не слать
        }
        if (altWheelAcc && Math.sign(altWheelAcc) !== Math.sign(ev.deltaY)) altWheelAcc = 0
        const step = ev.deltaMode === 1 ? 1 : ev.deltaMode === 2 ? 1 : 80
        altWheelAcc += ev.deltaY
        const appMode = term.modes && term.modes.applicationCursorKeysMode
        const up = mode === 'one' ? (appMode ? '\x1bOA' : '\x1b[A') : '\x1b[5~'
        const down = mode === 'one' ? (appMode ? '\x1bOB' : '\x1b[B') : '\x1b[6~'
        while (altWheelAcc <= -step) { routeInput(binding.id, up); altWheelAcc += step }
        while (altWheelAcc >= step) { routeInput(binding.id, down); altWheelAcc -= step }
        ev.preventDefault()
        return false
      } catch { return true }
    })
  }
  // звонок-уведомление от сервера/программы
  term.onBell(() => toast('Сигнал: ' + (tab.title || 'Терминал')))
  // отслеживаем фокус — куда вставлять и где искать
  if (term.textarea) {
    term.textarea.addEventListener('focus', () => {
      focusedSessId = binding.id
      tab.activeSlot = slot
    })
  }
  paneOf.set(sessId, { tab, slot })
  return { term, fit, search, binding }
}

function addTab(id, title, type, sshCfg) {
  const tabEl = document.createElement('div')
  const tabDomId = 'terminal-tab-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '-')
  tabEl.className = 'tab'
  tabEl.id = tabDomId
  tabEl.setAttribute('role', 'tab')
  tabEl.tabIndex = -1
  const badge = type === 'ssh' ? '<span class="tab-dot ok" title="Подключено"></span><span class="tab-badge">SSH</span>' : ''
  tabEl.innerHTML = badge + '<span class="tab-title"></span><button class="tab-close" title="Закрыть"><i class=ic-x></i></button>'
  tabEl.querySelector('.tab-title').textContent = title
  tabEl.addEventListener('click', () => activateTab(tab.id))
  tabEl.addEventListener('keydown', (event) => {
    if (event.target !== tabEl) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateTab(tab.id) }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const ids = [...tabs.keys()]
      const index = ids.indexOf(tab.id)
      const next = ids[(index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]
      if (next) { activateTab(next); tabs.get(next).tabEl.focus() }
    }
  })
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation()
    closeTab(tab.id, true)
  })
  $('#tabs').appendChild(tabEl)

  const paneEl = document.createElement('div')
  paneEl.className = 'term-pane hidden'
  paneEl.setAttribute('role', 'tabpanel')
  paneEl.setAttribute('aria-labelledby', tabDomId)
  $('#terms').appendChild(paneEl)

  const cellEl = document.createElement('div')
  cellEl.className = 'split-cell'
  paneEl.appendChild(cellEl)

  const tab = { id, type, title, tabEl, paneEl, sftpPath: '.', split: null, activeSlot: 'main', sshCfg: sshCfg || null }

  // двойной клик по вкладке — переименовать
  tabEl.addEventListener('dblclick', () => {
    const t = tabEl.querySelector('.tab-title')
    t.contentEditable = 'true'
    t.focus()
    try { document.execCommand('selectAll', false, null) } catch {}
    const finish = () => {
      t.contentEditable = 'false'
      tab.title = t.textContent.trim() || tab.title
      t.textContent = tab.title
    }
    t.addEventListener('blur', finish, { once: true })
    t.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); t.blur() }
    })
  })

  const made = makeTerm(id, tab, 'main', cellEl)
  tab.term = made.term
  tab.fit = made.fit
  tab.search = made.search
  tab.binding = made.binding

  tabs.set(id, tab)
  activateTab(id)
  updateEmptyState()
  return tab
}

function activateTab(id) {
  const tab = tabs.get(id)
  if (!tab) return
  if (tab.type === 'ssh') lastSshSessionId = id
  activeId = id
  for (const t of tabs.values()) {
    const isActive = t.id === id
    t.tabEl.classList.toggle('active', isActive)
    t.tabEl.setAttribute('aria-selected', String(isActive))
    t.tabEl.tabIndex = isActive ? 0 : -1
    t.paneEl.classList.toggle('hidden', !isActive)
  }
  $('#btn-sftp').classList.toggle('hidden', tab.type !== 'ssh')
  $('#btn-split').classList.remove('hidden')
  if (tab.type !== 'ssh') collapseSftp()
  else if (!$('#sftp-panel').classList.contains('collapsed')) {
    requestAnimationFrame(() => sftpList(tab.sftpPath || '.'))
  }
  requestAnimationFrame(() => {
    fitTab(tab)
    const t = tab.activeSlot === 'split' && tab.split ? tab.split.term : tab.term
    t.focus()
  })
}

function closeTab(id, killSession) {
  const tab = tabs.get(id)
  if (!tab) return
  tab.closing = true
  if (tab.split) closeSplit(tab, killSession)
  if (killSession) window.api.kill(id)
  paneOf.delete(id)
  flowState.delete(id)
  try { tab.term.dispose() } catch {}
  tab.tabEl.remove()
  tab.paneEl.remove()
  tabs.delete(id)
  if (focusedSessId === id) focusedSessId = null
  if (activeId === id) {
    activeId = null
    const rest = [...tabs.keys()]
    if (rest.length) activateTab(rest[rest.length - 1])
    else {
      $('#btn-sftp').classList.add('hidden')
      $('#btn-split').classList.add('hidden')
      collapseSftp()
    }
  }
  updateEmptyState()
}

// Закрыть вторую панель сплита
function closeSplit(tab, killSession) {
  const sp = tab.split
  if (!sp) return
  if (killSession) window.api.kill(sp.id)
  paneOf.delete(sp.id)
  flowState.delete(sp.id)
  try { sp.term.dispose() } catch {}
  sp.cellEl.remove()
  if (tab.dividerEl) { tab.dividerEl.remove(); tab.dividerEl = null }
  const mainCell = tab.paneEl.querySelector('.split-cell')
  if (mainCell) mainCell.style.flex = ''
  tab.split = null
  tab.activeSlot = 'main'
  tab.paneEl.classList.remove('split', 'split-v', 'split-h')
  if (focusedSessId === sp.id) focusedSessId = tab.id
  requestAnimationFrame(() => fitTab(tab))
}

// Разделить активную вкладку на две панели
async function splitTab(dir) {
  const tab = tabs.get(activeId)
  if (!tab) return
  if (tab.split) {
    closeSplit(tab, true)
    toast('Сплит закрыт')
    return
  }
  tab.splitDir = dir === 'h' ? 'h' : 'v'
  let res
  if (tab.type === 'ssh') {
    if (!tab.sshCfg) return toast('Для сплита SSH-вкладки переподключись к серверу', true)
    toast('Открываю вторую SSH-сессию…')
    const splitCfg = Object.assign({}, tab.sshCfg, { cols: tab.term.cols, rows: tab.term.rows })
    if (splitCfg.id) splitCfg.useSavedCredentials = true
    res = await window.api.createSsh(splitCfg)
  } else {
    res = await window.api.createLocal({ shell: settings.shell, cols: 80, rows: 24 })
  }
  if (res.error) return toast(res.error, true)
  const cellEl = document.createElement('div')
  cellEl.className = 'split-cell'
  const divider = document.createElement('div')
  divider.className = 'split-divider'
  tab.paneEl.appendChild(divider)
  tab.paneEl.appendChild(cellEl)
  tab.dividerEl = divider
  attachDividerDrag(tab, divider)
  tab.paneEl.classList.add('split', tab.splitDir === 'h' ? 'split-h' : 'split-v')
  const made = makeTerm(res.id, tab, 'split', cellEl)
  tab.split = { id: res.id, term: made.term, fit: made.fit, search: made.search, binding: made.binding, cellEl }
  toast('Экран разделён — тяни полоску между панелями, чтобы менять размер. Повторный клик закроет сплит')
  requestAnimationFrame(() => {
    fitTab(tab)
    made.term.focus()
  })
}

function nextTab() {
  const ids = [...tabs.keys()]
  if (ids.length < 2) return
  const i = ids.indexOf(activeId)
  activateTab(ids[(i + 1) % ids.length])
}

async function newLocalTab() {
  const res = await window.api.createLocal({ shell: settings.shell, cols: 80, rows: 24 })
  if (res.error) return toast(res.error, true)
  addTab(res.id, res.title, 'local')
}

// ---------- данные из сессий ----------

// v0.8.1: flow control (как в Tabby/VS Code) — при шквале вывода ставим источник
// на паузу, пока xterm не дорисует очередь. Без этого ввод ждёт в хвосте очереди
// и появляются пролаги 0.1-0.5с в TUI-приложениях (Claude Code и т.п.)
const flowState = new Map()
const smokeDataWaiters = new Map()
const FLOW_HIGH = 400000 // байт в очереди — ставим паузу
const FLOW_LOW = 80000   // очередь рассосалась — продолжаем

window.api.onData(({ id, data }) => {
  const smokeWaiter = smokeDataWaiters.get(id)
  if (smokeWaiter) smokeWaiter(data)
  const p = paneOf.get(id)
  if (!p) return
  const term = p.slot === 'split' ? (p.tab.split && p.tab.split.term) : p.tab.term
  if (!term) return
  let fc = flowState.get(id)
  if (!fc) { fc = { pending: 0, paused: false }; flowState.set(id, fc) }
  fc.pending += data.length
  if (!fc.paused && fc.pending > FLOW_HIGH) {
    fc.paused = true
    window.api.pauseStream(id)
  }
  animateTerminalText(term, 'output', data.length)
  term.write(data, () => {
    fc.pending -= data.length
    if (fc.paused && fc.pending < FLOW_LOW) {
      fc.paused = false
      window.api.resumeStream(id)
    }
  })
})

window.api.onExit(({ id, reason }) => {
  flowState.delete(id)
  const p = paneOf.get(id)
  if (!p) return
  if (p.slot === 'split') {
    if (p.tab.split) {
      p.tab.split.term.write('\r\n\x1b[90m[' + uiText('session ended', 'сессия завершена') + ']\x1b[0m\r\n')
      setTimeout(() => closeSplit(p.tab, false), 800)
    }
    return
  }
  const tb = p.tab
  if (tb.split) closeSplit(tb, true)
  if (tb.type === 'ssh' && reason === 'disconnect' && tb.sshCfg && !tb.closing && settings.autoReconnect !== false) {
    reconnectTab(tb)
    return
  }
  tb.term.write('\r\n\x1b[90m[' + uiText('session ended — tab will close', 'сессия завершена — вкладка закроется') + ']\x1b[0m\r\n')
  setTimeout(() => closeTab(tb.id, false), 1200)
})

// ---------- SSH модалка ----------

function openSshModal(prefill) {
  $('#ssh-name').value = (prefill && prefill.name) || ''
  $('#ssh-host').value = (prefill && prefill.host) || ''
  $('#ssh-port').value = (prefill && prefill.port) || '22'
  $('#ssh-user').value = (prefill && prefill.username) || ''
  $('#ssh-auth').value = prefill && prefill.authMode === 'key' ? 'key' : 'password'
  $('#ssh-password').value = (prefill && prefill.password) || ''
  $('#ssh-keypath').value = (prefill && prefill.keyPath) || ''
  $('#ssh-passphrase').value = (prefill && prefill.passphrase) || ''
  $('#ssh-save').checked = !prefill
  $('#ssh-savepass').checked = !!(prefill && (prefill.password || prefill.hasPassword || prefill.hasPassphrase))
  updateAuthRows()
  $('#ssh-save-only').classList.add('hidden')
  editingConnId = (prefill && prefill.id) || null
  $('#modal-ssh').classList.remove('hidden')
  if (prefill && prefill.host) $('#ssh-password').focus()
  else $('#ssh-host').focus()
}

function updateAuthRows() {
  const useKey = $('#ssh-auth').value === 'key'
  $('#ssh-key-rows').classList.toggle('hidden', !useKey)
  $('#ssh-password-row').classList.toggle('hidden', useKey)
}

async function sshConnectFromModal() {
  const cfg = {
    id: editingConnId || undefined,
    name: $('#ssh-name').value.trim(),
    host: $('#ssh-host').value.trim(),
    port: Number($('#ssh-port').value) || 22,
    username: $('#ssh-user').value.trim(),
    authMode: $('#ssh-auth').value === 'key' ? 'key' : 'password',
    useSavedCredentials: !!editingConnId,
  }
  if (!cfg.host || !cfg.username) return toast('Укажи хост и пользователя', true)
  const useKey = $('#ssh-auth').value === 'key'
  if (useKey) {
    cfg.keyPath = $('#ssh-keypath').value.trim()
    cfg.passphrase = $('#ssh-passphrase').value
    if (!cfg.keyPath) return toast('Укажи путь к приватному ключу', true)
  } else {
    cfg.password = $('#ssh-password').value
  }

  const btn = $('#ssh-connect')
  btn.disabled = true
  btn.textContent = 'Подключение…'
  const res = await window.api.createSsh(cfg)
  btn.disabled = false
  btn.textContent = 'Подключиться'
  if (res.error) return toast('SSH: ' + res.error, true)

  let reconnectProfile = null
  if ($('#ssh-save').checked) {
    const saved = {
      id: editingConnId || undefined,
      name: cfg.name || cfg.username + '@' + cfg.host,
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      authMode: cfg.authMode,
      keyPath: cfg.keyPath || '',
      clearPassphrase: !$('#ssh-savepass').checked || !useKey,
      clearPassword: !$('#ssh-savepass').checked || useKey,
    }
    if ($('#ssh-savepass').checked && cfg.passphrase) saved.passphrase = cfg.passphrase
    if ($('#ssh-savepass').checked && cfg.password) saved.password = cfg.password
    const cfgAll = await window.api.saveConnection(saved)
    if (cfgAll.error) {
      window.api.kill(res.id)
      return toast(cfgAll.error, true)
    }
    connections = cfgAll.connections || []
    renderConnections()
    reconnectProfile = editingConnId ? connections.find((item) => item.id === editingConnId) : connections.find((item) =>
      item.host === cfg.host && item.username === cfg.username && Number(item.port || 22) === Number(cfg.port || 22)
    )
  }

  $('#modal-ssh').classList.add('hidden')
  addTab(res.id, cfg.name || res.title, 'ssh', reconnectProfile || cfg)
}

// ---------- сохранённые подключения ----------

function renderConnections() {
  const list = $('#conn-list')
  list.innerHTML = ''
  if (!connections.length) {
    const d = document.createElement('div')
    d.className = 'sftp-msg'
    d.textContent = 'Пока пусто'
    list.appendChild(d)
    return
  }
  for (const conn of connections) {
    const item = document.createElement('div')
    item.className = 'conn-item'
    item.setAttribute('role', 'button')
    item.tabIndex = 0
    item.innerHTML = '<span class="conn-name"></span><span class="conn-host"></span><button class="conn-del" title="Удалить"><i class=ic-x></i></button>'
    item.querySelector('.conn-name').textContent = conn.name
    item.querySelector('.conn-host').textContent = conn.host
    item.title = conn.username + '@' + conn.host + ':' + conn.port + ' · ПКМ — меню'
    const hostEl = item.querySelector('.conn-host')
    hostEl.title = 'Клик — скопировать IP'
    hostEl.addEventListener('click', (e) => {
      e.stopPropagation()
      copyText(conn.host)
      toast('IP скопирован: ' + conn.host)
    })
    item.addEventListener('click', () => connectSaved(conn))
    item.addEventListener('keydown', (event) => {
      if (event.target !== item) return
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); connectSaved(conn) }
    })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showCtxMenu(e.clientX, e.clientY, connMenuItems(conn))
    })
    item.querySelector('.conn-del').addEventListener('click', async (e) => {
      e.stopPropagation()
      const cfgAll = await window.api.deleteConnection(conn.id)
      if (cfgAll.error) return toast(cfgAll.error, true)
      connections = cfgAll.connections || []
      renderConnections()
    })
    list.appendChild(item)
  }
}

async function connectSaved(conn) {
  // если нет сохранённого пароля/ключа — открываем форму, чтобы ввести пароль
  if ((conn.authMode === 'key' && !conn.keyPath) || (conn.authMode !== 'key' && !conn.hasPassword)) {
    openSshModal(conn)
    $('#ssh-save').checked = true
    $('#ssh-savepass').checked = true
    toast('Пароль не был сохранён. Введи его — с галочкой «Сохранить пароль» вход будет в один клик')
    return
  }
  toast('Подключение к ' + conn.name + '…')
  const res = await window.api.createSsh({
    id: conn.id,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    authMode: conn.authMode === 'key' ? 'key' : 'password',
    keyPath: conn.authMode === 'key' ? conn.keyPath : '',
    useSavedCredentials: true,
  })
  if (res.error) {
    toast('SSH: ' + res.error, true)
    return openSshModal(conn)
  }
  addTab(res.id, conn.name || res.title, 'ssh', conn)
}

// ---------- SFTP ----------

function collapseSftp() {
  $('#sftp-panel').classList.add('collapsed')
}

function toggleSftp() {
  const panel = $('#sftp-panel')
  const willOpen = panel.classList.contains('collapsed')
  panel.classList.toggle('collapsed')
  const tab = tabs.get(activeId)
  if (willOpen && tab && tab.type === 'ssh') sftpList(tab.sftpPath || '.')
  if (tab) requestAnimationFrame(() => fitTab(tab))
}

let sftpRequestSerial = 0
async function sftpList(dir) {
  const tab = tabs.get(activeId)
  if (!tab || tab.type !== 'ssh') return
  const serial = ++sftpRequestSerial
  tab.sftpRequestSerial = serial
  const listEl = $('#sftp-list')
  listEl.innerHTML = '<div class="sftp-msg">Загрузка…</div>'
  const res = await window.api.sftpList(tab.id, dir)
  if (tabs.get(activeId) !== tab || tab.sftpRequestSerial !== serial) return
  if (res.error) {
    listEl.innerHTML = ''
    const d = document.createElement('div')
    d.className = 'sftp-msg'
    d.textContent = 'Ошибка: ' + res.error
    listEl.appendChild(d)
    return
  }
  tab.sftpPath = res.path || dir
  $('#sftp-path').value = tab.sftpPath
  listEl.innerHTML = ''
  if (!res.entries.length) {
    listEl.innerHTML = '<div class="sftp-msg">Пустая папка</div>'
    return
  }
  for (const entry of res.entries) {
    const row = document.createElement('div')
    row.className = 'sftp-row' + (entry.isDir ? ' dir' : '')
    row.innerHTML =
      '<span class="sftp-ico">' + (entry.isDir ? ICON_DIR : ICON_FILE) + '</span>' +
      '<span class="sftp-name"></span>' +
      '<span class="sftp-size"></span>' +
      '<button class="sftp-dl" title="' + (entry.isDir ? 'Скачать папку' : 'Скачать') + '"><i class=ic-download></i></button>'
    row.querySelector('.sftp-name').textContent = entry.name
    row.querySelector('.sftp-size').textContent = entry.isDir ? '' : fmtSize(entry.size)
    const cur = tab.sftpPath || '.'
    const fullPath = cur === '/' ? '/' + entry.name : cur === '.' ? entry.name : cur.replace(/\/+$/, '') + '/' + entry.name
    const dl = row.querySelector('.sftp-dl')
    if (entry.isDir) {
      row.addEventListener('dblclick', () => sftpList(fullPath))
      row.addEventListener('click', (ev) => { if (!ev.target.closest('.sftp-dl')) sftpList(fullPath) })
      dl.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        toast('Скачивание папки ' + entry.name + '…')
        const r = await window.api.sftpDownloadDir(tab.id, fullPath, entry.name)
        if (r.error) toast('Ошибка: ' + r.error, true)
        else if (!r.canceled) toast('Папка скачана (' + r.count + ' файл.): ' + r.localPath)
      })
    } else {
      dl.addEventListener('click', async () => {
        toast('Скачивание ' + entry.name + '…')
        const r = await window.api.sftpDownload(tab.id, fullPath, entry.name)
        if (r.error) toast('Ошибка: ' + r.error, true)
        else if (!r.canceled) toast('Сохранено: ' + r.localPath)
      })
    }
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      showCtxMenu(ev.clientX, ev.clientY, sftpMenuItems(tab, entry, fullPath))
    })
    listEl.appendChild(row)
  }
  if (res.truncated) {
    const message = document.createElement('div')
    message.className = 'sftp-msg'
    message.textContent = 'Показаны первые 10 000 элементов. Открой нужный путь вручную.'
    listEl.appendChild(message)
  }
}

function sftpUp() {
  const tab = tabs.get(activeId)
  if (!tab) return
  const cur = tab.sftpPath || '.'
  if (cur === '/') return
  if (cur === '.') return sftpList('..')
  const parts = cur.split('/').filter(Boolean)
  parts.pop()
  sftpList('/' + parts.join('/'))
}

// ---------- события ----------

$('#btn-new-local').addEventListener('click', newLocalTab)
$('#btn-new-ssh').addEventListener('click', () => openSshModal(null))
$('#btn-settings').addEventListener('click', openSettings)
$('#btn-sftp').addEventListener('click', toggleSftp)

$('#ssh-auth').addEventListener('change', updateAuthRows)
$('#ssh-cancel').addEventListener('click', () => $('#modal-ssh').classList.add('hidden'))
$('#ssh-connect').addEventListener('click', sshConnectFromModal)
$('#ssh-keypick').addEventListener('click', async () => {
  const p = await window.api.pickFile()
  if (p) $('#ssh-keypath').value = p
})

$('#sftp-go').addEventListener('click', () => sftpList($('#sftp-path').value.trim() || '.'))
$('#sftp-path').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sftpList($('#sftp-path').value.trim() || '.')
})
$('#sftp-up').addEventListener('click', sftpUp)
$('#sftp-refresh').addEventListener('click', () => {
  const tab = tabs.get(activeId)
  if (tab) sftpList(tab.sftpPath || '.')
})
$('#sftp-upload').addEventListener('click', async () => {
  const tab = tabs.get(activeId)
  if (!tab || tab.type !== 'ssh') return
  const r = await window.api.sftpUpload(tab.id, tab.sftpPath || '.')
  if (r.error) toast('Ошибка: ' + r.error, true)
  else if (!r.canceled) {
    toast('Загружено: ' + r.remote)
    sftpList(tab.sftpPath || '.')
  }
})

// ---------- поиск по буферу (Ctrl+F) ----------

function toggleSearch(show) {
  const bar = $('#searchbar')
  bar.classList.toggle('hidden', !show)
  if (show) {
    $('#search-input').focus()
    $('#search-input').select()
  } else {
    const tab = tabs.get(activeId)
    if (tab) tab.term.focus()
  }
}

function doSearch(forward) {
  const tab = tabs.get(activeId)
  const q = $('#search-input').value
  if (!tab || !q) return
  const s = tab.activeSlot === 'split' && tab.split ? tab.split.search : tab.search
  if (!s) return
  try {
    if (forward) s.findNext(q)
    else s.findPrevious(q)
  } catch {}
}

$('#search-next').addEventListener('click', () => doSearch(true))
$('#search-prev').addEventListener('click', () => doSearch(false))
$('#search-close').addEventListener('click', () => toggleSearch(false))
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(!e.shiftKey)
})

// ---------- Ctrl+V: вставка скриншота/файла как пути ----------

async function handlePaste() {
  const sid = focusedSessId && paneOf.has(focusedSessId) ? focusedSessId : activeId
  const p = paneOf.get(sid)
  if (!p) return
  const term = p.slot === 'split' && p.tab.split ? p.tab.split.term : p.tab.term
  const r = await window.api.pasteMedia(sid)
  if (r && r.handled) return toast('Файл готов, путь вставлен: ' + r.path)
  if (r && r.error) return toast('Не удалось загрузить файл: ' + r.error, true)
  // в буфере не файл и не картинка — обычная вставка текста
  try {
    let text = ''
    try { text = await window.api.clipboardRead() } catch {}
    if (!text) { try { text = await navigator.clipboard.readText() } catch {} }
    if (text) safePaste(sid, text, term)
  } catch {}
}

// горячие клавиши (capture, чтобы перехватывать раньше xterm)
window.addEventListener(
  'keydown',
  (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
      e.preventDefault()
      newLocalTab()
    } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') {
      e.preventDefault()
      if (activeId) closeTab(activeId, true)
    } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault()
      splitTab()
    } else if (e.ctrlKey && !e.shiftKey && e.code === 'Tab') {
      e.preventDefault()
      nextTab()
    } else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
      e.preventDefault()
      toggleSearch(true)
    } else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyV' && e.target.closest && e.target.closest('.xterm')) {
      e.preventDefault()
      handlePaste()
    } else if (e.key === 'Escape') {
      $('#modal-ssh').classList.add('hidden')
      $('#modal-snippet').classList.add('hidden')
      hideCtxMenu()
      if (!$('#searchbar').classList.contains('hidden')) toggleSearch(false)
    }
  },
  true
)

// подгонка размера при изменении окна/панелей
const ro = new ResizeObserver(() => {
  const tab = tabs.get(activeId)
  if (tab) fitTab(tab)
})
ro.observe($('#terms'))

// ---------- старт ----------

async function init() {
  const cfg = await window.api.getConfig()
  rendererSmokeTest = cfg.smokeTest === true
  rendererPlatform = cfg.platform || ''
  currentAppVersion = cfg.appVersion || ''
  if (rendererSmokeTest && cfg.configNotice) throw new Error(cfg.configNotice)
  connections = cfg.connections || []
  settings = Object.assign({}, settings, cfg.settings || {})
  backgroundResourceUrl = cfg.backgroundResourceUrl || ''
  if (window.MeowI18n) window.MeowI18n.setLanguage(settings.language || 'auto')
  rendererSafeMode = cfg.safeMode === true
  if (rendererSafeMode) settings.webglRenderer = false
  applyBodyTheme()
  renderConnections()
  renderSnippets()
  updateEmptyState()
  try { renderUpdateState(await window.api.getUpdateState()) } catch {}
  if (cfg.configNotice) toast(cfg.configNotice, true)
  if (cfg.securityWarning) setTimeout(() => toast(cfg.securityWarning, true), cfg.configNotice ? 4300 : 0)
  else if (rendererSafeMode) setTimeout(() => toast('Безопасный режим: GPU-рендеринг отключён после прошлого сбоя'), cfg.configNotice ? 4300 : 0)
}

const initPromise = init()
initPromise.catch((err) => {
  toast('Не удалось загрузить конфигурацию: ' + (err && err.message ? err.message : err), true)
})

// ---------- v0.3: быстрые команды, сайдбар, сплит, SFTP dnd ----------

function renderSnippets() {
  const wrap = $('#snippets')
  wrap.innerHTML = ''
  ;(settings.snippets || []).forEach((s, i) => {
    const b = document.createElement('button')
    b.className = 'btn small snippet'
    b.textContent = s.name
    b.title = s.cmd + (s.enter ? ' ⏎' : '') + ' · ПКМ — удалить'
    b.addEventListener('click', () => runSnippet(s))
    b.addEventListener('contextmenu', async (e) => {
      e.preventDefault()
      const removed = settings.snippets.splice(i, 1)[0]
      if (!await saveSettingsChecked()) {
        settings.snippets.splice(i, 0, removed)
        return
      }
      renderSnippets()
      toast('Команда удалена')
    })
    wrap.appendChild(b)
  })
}

function runSnippet(s) {
  const sid = focusedSessId && paneOf.has(focusedSessId) ? focusedSessId : activeId
  if (!sid) return toast('Нет активной вкладки', true)
  window.api.write(sid, s.cmd + (s.enter ? '\r' : ''))
}

$('#btn-snippet-add').addEventListener('click', () => {
  $('#snip-name').value = ''
  $('#snip-cmd').value = ''
  $('#snip-enter').checked = true
  $('#modal-snippet').classList.remove('hidden')
  $('#snip-name').focus()
})
$('#snip-cancel').addEventListener('click', () => $('#modal-snippet').classList.add('hidden'))
$('#snip-save').addEventListener('click', async () => {
  const name = $('#snip-name').value.trim()
  const cmd = $('#snip-cmd').value
  if (!name || !cmd) return toast('Заполни название и команду', true)
  settings.snippets = settings.snippets || []
  settings.snippets.push({ name, cmd, enter: $('#snip-enter').checked })
  if (!await saveSettingsChecked()) {
    settings.snippets.pop()
    return
  }
  renderSnippets()
  $('#modal-snippet').classList.add('hidden')
  toast('Команда добавлена')
})

$('#btn-sidebar').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-hidden')
  setTimeout(() => { const t = tabs.get(activeId); if (t) fitTab(t) }, 240)
})

$('#btn-split').addEventListener('click', splitTab)

// SFTP: drag&drop, прогресс, новая папка
const sftpPanel = $('#sftp-panel')
sftpPanel.addEventListener('dragover', (e) => { e.preventDefault(); sftpPanel.classList.add('dragging') })
sftpPanel.addEventListener('dragleave', () => sftpPanel.classList.remove('dragging'))
sftpPanel.addEventListener('drop', async (e) => {
  e.preventDefault()
  sftpPanel.classList.remove('dragging')
  const tab = tabs.get(activeId)
  if (!tab || tab.type !== 'ssh') return
  const grants = await window.api.grantUploadFiles([...e.dataTransfer.files])
  if (!grants || !grants.length) return
  toast('Загружаю: ' + grants.length + ' файл(ов)…')
  const r = await window.api.sftpUploadGrants(tab.id, tab.sftpPath || '.', grants)
  if (r.error) toast('Ошибка загрузки: ' + r.error, true)
  else { toast('Загружено файлов: ' + r.remotes.length); sftpList(tab.sftpPath || '.') }
})

const progressRows = new Map()
window.api.onSftpProgress(({ id, name, done, total }) => {
  const el = $('#sftp-progress')
  const key = String(id) + ':' + String(name)
  let row = progressRows.get(key)
  if (!row) {
    row = document.createElement('div')
    row.className = 'sftp-prog'
    row.innerHTML = '<span class="sftp-prog-name"></span><div class="sftp-prog-bar"><div class="sftp-prog-fill"></div></div>'
    row.querySelector('.sftp-prog-name').textContent = name
    el.appendChild(row)
    progressRows.set(key, row)
  }
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0
  row.querySelector('.sftp-prog-fill').style.width = pct + '%'
  if (pct >= 100) setTimeout(() => { row.remove(); progressRows.delete(key) }, 800)
})

$('#sftp-mkdir').addEventListener('click', () => {
  $('#sftp-mkdir-row').classList.toggle('hidden')
  $('#sftp-mkdir-name').focus()
})
$('#sftp-mkdir-name').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return
  const tab = tabs.get(activeId)
  const name = $('#sftp-mkdir-name').value.trim()
  if (!tab || tab.type !== 'ssh' || !name) return
  const r = await window.api.sftpMkdir(tab.id, tab.sftpPath || '.', name)
  if (r.error) return toast('Ошибка: ' + r.error, true)
  $('#sftp-mkdir-name').value = ''
  $('#sftp-mkdir-row').classList.add('hidden')
  toast('Папка создана')
  sftpList(tab.sftpPath || '.')
})

// ---------- v0.4: плавный курсор и импорт из Tabby ----------

// «Призрачный» курсор, который плавно скользит за настоящим — эффект анимации ввода
function attachSmoothCursor(term) {
  try {
    const attach = () => {
      const screen = term.element && term.element.querySelector('.xterm-screen')
      if (!screen) return
      const ghost = document.createElement('div')
      ghost.className = 'cursor-ghost'
      screen.appendChild(ghost)
      const update = () => {
        if (settings.smoothCursor === false) { ghost.style.opacity = '0'; return }
        try {
          const dims = term._core._renderService.dimensions.css.cell
          const b = term.buffer.active
          if (!dims || !dims.width) return
          ghost.style.width = dims.width + 'px'
          ghost.style.height = dims.height + 'px'
          ghost.style.left = b.cursorX * dims.width + 'px'
          ghost.style.top = b.cursorY * dims.height + 'px'
          ghost.style.opacity = '0.45'
        } catch { ghost.style.opacity = '0' }
      }
      term.onCursorMove(update)
      term.onResize(update)
      update()
    }
    // элемент терминала появляется после term.open — цепляемся на следующем кадре
    requestAnimationFrame(attach)
  } catch {}
}

// ---------- v0.5: контекстное меню, эффект ввода, иконки SFTP ----------

// SVG-иконки вместо эмодзи (не зависят от шрифтов системы)
const ICON_DIR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#e8b339"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>'
const ICON_FILE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b95a5" stroke-width="2" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'

// Мини контекстное меню
let ctxMenuEl = null
function hideCtxMenu() {
  if (ctxMenuEl) {
    ctxMenuEl.remove()
    ctxMenuEl = null
  }
}
function showCtxMenu(x, y, items) {
  hideCtxMenu()
  const m = document.createElement('div')
  m.className = 'ctx-menu'
  for (const it of items) {
    if (it === '-') {
      const d = document.createElement('div')
      d.className = 'ctx-sep'
      m.appendChild(d)
      continue
    }
    const b = document.createElement('button')
    b.className = 'ctx-item' + (it.danger ? ' danger' : '')
    b.innerHTML = it.label
    b.addEventListener('click', () => {
      hideCtxMenu()
      it.onClick()
    })
    m.appendChild(b)
  }
  document.body.appendChild(m)
  const r = m.getBoundingClientRect()
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px'
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px'
  ctxMenuEl = m
}
window.addEventListener('click', hideCtxMenu)

function connMenuItems(conn) {
  return [
    { label: '<i class=ic-play></i> Подключиться', onClick: () => connectSaved(conn) },
    { label: '<i class=ic-sliders></i> Настроить сервер', onClick: () => openSshEditor(conn) },
    { label: '<i class=ic-copy></i> Копировать IP', onClick: () => { copyText(conn.host); toast('IP скопирован: ' + conn.host) } },
    { label: '<i class=ic-copy></i> Копировать user@host', onClick: () => { copyText(conn.username + '@' + conn.host); toast('Скопировано: ' + conn.username + '@' + conn.host) } },
    { label: '<i class=ic-terminal></i> Копировать команду ssh', onClick: async () => {
      const result = await window.api.formatSshCommand(conn)
      if (result.error) return toast(result.error, true)
      copyText(result.command)
      toast('Команда скопирована')
    } },
    '-',
    { label: '<i class=ic-trash></i> Удалить из списка', danger: true, onClick: async () => {
      const cfgAll = await window.api.deleteConnection(conn.id)
      if (cfgAll.error) return toast(cfgAll.error, true)
      connections = cfgAll.connections || []
      renderConnections()
      toast('Сервер удалён')
    } },
  ]
}

// Кнопка «Сохранить» в SSH-модалке (редактирование без подключения)
const sshSaveOnlyBtn = document.createElement('button')
sshSaveOnlyBtn.id = 'ssh-save-only'
sshSaveOnlyBtn.className = 'btn ghost hidden'
sshSaveOnlyBtn.textContent = 'Сохранить'
$('#ssh-connect').parentElement.insertBefore(sshSaveOnlyBtn, $('#ssh-connect'))

function openSshEditor(conn) {
  openSshModal(conn)
  $('#ssh-save').checked = true
  $('#ssh-savepass').checked = !!(conn.hasPassword || conn.hasPassphrase)
  $('#ssh-save-only').classList.remove('hidden')
  $('#ssh-name').focus()
}

sshSaveOnlyBtn.addEventListener('click', async () => {
  const host = $('#ssh-host').value.trim()
  const username = $('#ssh-user').value.trim()
  if (!host || !username) return toast('Укажи хост и пользователя', true)
  const useKey = $('#ssh-auth').value === 'key'
  const saved = {
    id: editingConnId || undefined,
    name: $('#ssh-name').value.trim() || username + '@' + host,
    host,
    port: Number($('#ssh-port').value) || 22,
    username,
    authMode: useKey ? 'key' : 'password',
    keyPath: useKey ? $('#ssh-keypath').value.trim() : '',
    clearPassphrase: !useKey || !$('#ssh-savepass').checked,
    clearPassword: useKey || !$('#ssh-savepass').checked,
  }
  if (useKey && $('#ssh-savepass').checked && $('#ssh-passphrase').value) saved.passphrase = $('#ssh-passphrase').value
  if (!useKey && $('#ssh-savepass').checked && $('#ssh-password').value) saved.password = $('#ssh-password').value
  const cfgAll = await window.api.saveConnection(saved)
  if (cfgAll.error) return toast(cfgAll.error, true)
  connections = cfgAll.connections || []
  renderConnections()
  $('#modal-ssh').classList.add('hidden')
  toast('Сервер сохранён')
})

// Эффект при вводе текста: свечение или искры у курсора
let lastFxTime = 0
function typingFx(term) {
  if (!settings.typingFx || settings.typingFx === 'off') return
  const now = performance.now()
  if (now - lastFxTime < 33) return
  lastFxTime = now
  try {
    const screen = term.element && term.element.querySelector('.xterm-screen')
    if (!screen) return
    const dims = term._core._renderService.dimensions.css.cell
    if (!dims || !dims.width) return
    const b = term.buffer.active
    const x = b.cursorX * dims.width + dims.width / 2
    const y = b.cursorY * dims.height + dims.height / 2
    if (settings.typingFx === 'glow') {
      const el = document.createElement('div')
      el.className = 'type-glow'
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      screen.appendChild(el)
      setTimeout(() => el.remove(), 400)
    } else if (settings.typingFx === 'sparks') {
      for (let i = 0; i < 5; i++) {
        const p = document.createElement('div')
        p.className = 'type-spark'
        p.style.left = x + 'px'
        p.style.top = y + 'px'
        screen.appendChild(p)
        const ang = Math.random() * Math.PI * 2
        const dist = 8 + Math.random() * 16
        const anim = p.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: 'translate(' + Math.cos(ang) * dist + 'px,' + (Math.sin(ang) * dist - 5) + 'px) scale(0.2)', opacity: 0 },
          ],
          { duration: 280 + Math.random() * 220, easing: 'ease-out' }
        )
        anim.onfinish = () => p.remove()
        setTimeout(() => p.remove(), 600)
      }
    }
  } catch {}
}

// Лёгкое появление текста при вводе и выводе. Web Animations не заставляет
// пересобирать DOM xterm и отключается для reduced motion и больших потоков.
const terminalTextMotion = new WeakMap()
function animateTerminalText(term, kind, amount) {
  if (settings.smoothTextAnimation === false || amount > 32768 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  try {
    const screen = term.element && term.element.querySelector('.xterm-screen')
    if (!screen || !screen.animate || screen.closest('.term-pane.hidden')) return
    const now = performance.now()
    const state = terminalTextMotion.get(term) || { input: 0, output: 0 }
    const interval = kind === 'input' ? 38 : 90
    if (now - state[kind] < interval) return
    state[kind] = now
    terminalTextMotion.set(term, state)
    const frames = kind === 'input'
      ? [{ opacity: 0.94, filter: 'brightness(1.16)', transform: 'translateY(0.4px)' }, { opacity: 1, filter: 'brightness(1)', transform: 'translateY(0)' }]
      : [{ opacity: 0.92, filter: 'brightness(1.08)', transform: 'translateY(1px)' }, { opacity: 1, filter: 'brightness(1)', transform: 'translateY(0)' }]
    screen.animate(frames, {
      duration: kind === 'input' ? 125 : 190,
      easing: 'cubic-bezier(.2,.75,.25,1)',
    })
  } catch {}
}

// ---------- v0.7 ----------

// Тема xterm с учётом фонового изображения (прозрачный фон терминала)
function xtermTheme() {
  const th = THEMES[settings.theme] || THEMES.dark
  if (settings.bgImage) return Object.assign({}, th.xterm, { background: 'rgba(0,0,0,0)' })
  return th.xterm
}

// Фоновое изображение
let bgLayer = null
let backgroundResourceUrl = ''
function applyBackground() {
  if (!bgLayer) {
    bgLayer = document.createElement('div')
    bgLayer.id = 'bg-layer'
    document.body.prepend(bgLayer)
  }
  const has = !!settings.bgImage && !!backgroundResourceUrl
  document.body.classList.toggle('has-bg', has)
  if (has) {
    bgLayer.style.backgroundImage = 'url("' + backgroundResourceUrl.replace(/"/g, '') + '")'
    bgLayer.style.filter = 'blur(' + (settings.bgBlur || 0) + 'px)'
    bgLayer.style.opacity = '1'
  } else {
    bgLayer.style.opacity = '0'
  }
  const dim = settings.bgDim == null ? 40 : settings.bgDim
  document.documentElement.style.setProperty('--bg-dim', String(dim / 100))
}

// Перетаскиваемый разделитель сплита
let dragFitPending = false
function attachDividerDrag(tab, divider) {
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault()
    divider.classList.add('active')
    document.body.classList.add('resizing')
    const pane = tab.paneEl
    const mainCell = pane.querySelector('.split-cell')
    const onMove = (ev) => {
      const r = pane.getBoundingClientRect()
      const horiz = tab.splitDir === 'h'
      let pct = horiz ? ((ev.clientY - r.top) / r.height) * 100 : ((ev.clientX - r.left) / r.width) * 100
      pct = Math.min(85, Math.max(15, pct))
      mainCell.style.flex = '0 0 ' + pct + '%'
      if (!dragFitPending) {
        dragFitPending = true
        requestAnimationFrame(() => { dragFitPending = false; fitTab(tab) })
      }
    }
    const onUp = () => {
      divider.classList.remove('active')
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      fitTab(tab)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
}

$('#btn-split').title = 'Разделить экран: ЛКМ — вертикально (Ctrl+Shift+D), ПКМ — горизонтально (Ctrl+Shift+E)'
$('#btn-split').addEventListener('contextmenu', (e) => {
  e.preventDefault()
  splitTab('h')
})

// Автопереподключение SSH
function setTabDot(tab, state) {
  const dot = tab.tabEl.querySelector('.tab-dot')
  if (!dot) return
  dot.className = 'tab-dot ' + state
  dot.title = state === 'ok' ? 'Подключено' : state === 'connecting' ? 'Переподключение…' : 'Обрыв соединения'
}

async function reconnectTab(tab) {
  if (tab.reconnecting) return
  tab.reconnecting = true
  const maxTries = 5
  for (let i = 1; i <= maxTries; i++) {
    if (tab.closing) break
    setTabDot(tab, 'connecting')
    tab.term.write('\r\n\x1b[33m[' + uiText('connection lost — reconnecting ', 'обрыв соединения — переподключение ') + i + '/' + maxTries + '…]\x1b[0m\r\n')
    const reconnectCfg = Object.assign({}, tab.sshCfg, tab.term ? { cols: tab.term.cols, rows: tab.term.rows } : {})
    if (reconnectCfg.id) reconnectCfg.useSavedCredentials = true
    const res = await window.api.createSsh(reconnectCfg)
    if (tab.closing) {
      if (!res.error) window.api.kill(res.id)
      break
    }
    if (!res.error) {
      const oldId = tab.id
      const monitorWasOpen = !!tab.monBar
      tabs.delete(oldId)
      paneOf.delete(oldId)
      flowState.delete(oldId)
      for (const key of [...runningTunnels]) {
        if (key.startsWith(oldId + ':')) runningTunnels.delete(key)
      }
      tab.id = res.id
      tab.binding.id = res.id
      tabs.set(res.id, tab)
      paneOf.set(res.id, { tab, slot: 'main' })
      const mainCell = tab.paneEl.querySelector('.split-cell')
      if (mainCell) mainCell.dataset.sessionId = res.id
      if (activeId === oldId) activeId = res.id
      if (focusedSessId === oldId) focusedSessId = res.id
      if (lastSshSessionId === oldId) lastSshSessionId = res.id
      tab.reconnecting = false
      setTabDot(tab, 'ok')
      tab.term.write('\x1b[32m[' + uiText('connection restored', 'соединение восстановлено') + ']\x1b[0m\r\n')
      if (monitorWasOpen) window.api.monitorStart(res.id, (settings.monitorInterval || 3) * 1000)
      const conn = tab.sshCfg && tab.sshCfg.id ? connections.find((item) => item.id === tab.sshCfg.id) : null
      for (const tunnel of (conn && conn.tunnels) || (tab.sshCfg && tab.sshCfg.tunnels) || []) {
        if (tunnel.auto) startTunnel(res.id, tunnel, true)
      }
      requestAnimationFrame(() => fitTab(tab))
      return
    }
    setTabDot(tab, 'bad')
    await new Promise((r) => setTimeout(r, Math.min(15000, 2000 * i)))
  }
  tab.reconnecting = false
  setTabDot(tab, 'bad')
  if (!tab.closing) {
    tab.term.write('\r\n\x1b[31m[' + uiText('reconnection failed — tab will close', 'не удалось переподключиться — вкладка закроется') + ']\x1b[0m\r\n')
    setTimeout(() => closeTab(tab.id, false), 2500)
  }
}

// Универсальные диалоги
function makeDialog(innerHtml) {
  const bd = document.createElement('div')
  bd.className = 'modal-backdrop'
  const m = document.createElement('div')
  m.className = 'modal'
  m.setAttribute('role', 'dialog')
  m.setAttribute('aria-modal', 'true')
  m.tabIndex = -1
  m.innerHTML = innerHtml
  bd.appendChild(m)
  document.body.appendChild(bd)
  const previousFocus = document.activeElement
  let closed = false
  let beforeClose = null
  const closeListeners = []
  const close = () => {
    if (closed || (beforeClose && beforeClose() === false)) return false
    closed = true
    bd.remove()
    if (previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus()
    for (const listener of closeListeners) listener()
    return true
  }
  bd.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...m.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  bd.addEventListener('mousedown', (event) => { if (event.target === bd) close() })
  setTimeout(() => {
    const heading = m.querySelector('h1, h2, h3')
    if (heading) {
      if (!heading.id) heading.id = 'dialog-title-' + Math.random().toString(36).slice(2)
      m.setAttribute('aria-labelledby', heading.id)
    }
    const first = m.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
    ;(first || m).focus()
  }, 0)
  return {
    bd,
    m,
    close,
    onClose: (listener) => closeListeners.push(listener),
    setBeforeClose: (listener) => { beforeClose = listener },
  }
}

function askInput(title, initial, cb) {
  const d = makeDialog('<h2></h2><input type="text"><div class="modal-actions"><button class="btn ghost">Отмена</button><button class="btn primary">OK</button></div>')
  d.m.querySelector('h2').textContent = title
  const inp = d.m.querySelector('input')
  inp.value = initial || ''
  const btns = d.m.querySelectorAll('.modal-actions .btn')
  const ok = () => {
    const v = inp.value.trim()
    d.close()
    cb(v)
  }
  btns[1].addEventListener('click', ok)
  btns[0].addEventListener('click', () => d.close())
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') ok()
    if (e.key === 'Escape') d.close()
  })
  setTimeout(() => { inp.focus(); inp.select() }, 30)
}

function askConfirm(text, cb) {
  const d = makeDialog('<h2>Подтверждение</h2><p class="confirm-text"></p><div class="modal-actions"><button class="btn ghost">Отмена</button><button class="btn primary">Да</button></div>')
  d.m.querySelector('.confirm-text').textContent = text
  const btns = d.m.querySelectorAll('.modal-actions .btn')
  btns[1].addEventListener('click', () => { d.close(); cb() })
  btns[0].addEventListener('click', () => d.close())
  setTimeout(() => btns[1].focus(), 30)
}

// SFTP 2.0: контекстное меню файлов
function sftpMenuItems(tab, entry, fullPath) {
  const items = []
  if (entry.isDir) {
    items.push({ label: '<i class=ic-folder></i> Открыть', onClick: () => sftpList(fullPath) })
    items.push({ label: '<i class=ic-download></i> Скачать папку', onClick: async () => {
      toast('Скачивание папки ' + entry.name + '…')
      const r = await window.api.sftpDownloadDir(tab.id, fullPath, entry.name)
      if (r.error) toast('Ошибка: ' + r.error, true)
      else if (!r.canceled) toast('Папка скачана (' + r.count + ' файл.): ' + r.localPath)
    } })
  } else {
    items.push({ label: '<i class=ic-pencil></i> Редактировать', onClick: () => openRemoteEditor(tab, entry, fullPath) })
    items.push({ label: '<i class=ic-download></i> Скачать', onClick: async () => {
      toast('Скачивание ' + entry.name + '…')
      const r = await window.api.sftpDownload(tab.id, fullPath, entry.name)
      if (r.error) toast('Ошибка: ' + r.error, true)
      else if (!r.canceled) toast('Сохранено: ' + r.localPath)
    } })
  }
  items.push({ label: '<i class=ic-pencil></i> Переименовать', onClick: () => {
    askInput('Новое имя', entry.name, async (val) => {
      if (!val || val === entry.name) return
      const dir = fullPath.slice(0, fullPath.length - entry.name.length)
      const r = await window.api.sftpRename(tab.id, fullPath, dir + val)
      if (r.error) return toast('Ошибка: ' + r.error, true)
      toast('Переименовано')
      sftpList(tab.sftpPath)
    })
  } })
  items.push({ label: '<i class=ic-lock></i> Права (chmod)', onClick: () => {
    askInput('Права для «' + entry.name + '», например 755 или 644', '', async (val) => {
      if (!/^[0-7]{3,4}$/.test(val)) return toast('Нужен формат вида 755', true)
      const r = await window.api.sftpChmod(tab.id, fullPath, val)
      if (r.error) return toast('Ошибка: ' + r.error, true)
      toast('Права изменены: ' + val)
      sftpList(tab.sftpPath)
    })
  } })
  items.push('-')
  items.push({ label: '<i class=ic-trash></i> Удалить' + (entry.isDir ? ' папку' : ''), danger: true, onClick: () => {
    askConfirm('Удалить «' + entry.name + '»' + (entry.isDir ? ' со всем содержимым' : '') + '? Это нельзя отменить.', async () => {
      const r = await window.api.sftpDelete(tab.id, fullPath, entry.isDir)
      if (r.error) return toast('Ошибка: ' + r.error, true)
      toast('Удалено: ' + entry.name)
      sftpList(tab.sftpPath)
    })
  } })
  return items
}

// Редактор удалённых файлов
async function openRemoteEditor(tab, entry, fullPath) {
  toast('Загрузка ' + entry.name + '…')
  const r = await window.api.sftpReadFile(tab.id, fullPath)
  if (r.error) return toast('Ошибка: ' + r.error, true)
  const d = makeDialog('<h2></h2><textarea class="editor-area" spellcheck="false"></textarea><div class="modal-actions"><span class="editor-hint">Ctrl+S — сохранить, Esc — закрыть</span><button class="btn ghost">Закрыть</button><button class="btn primary">💾 Сохранить</button></div>')
  d.m.classList.add('editor-modal')
  d.m.querySelector('h2').textContent = fullPath
  const ta = d.m.querySelector('textarea')
  ta.value = r.content
  let savedContent = r.content
  let version = r.version
  let confirmedClose = false
  const btns = d.m.querySelectorAll('.modal-actions .btn')
  const save = async () => {
    const w = await window.api.sftpWriteFile(tab.id, fullPath, ta.value, version)
    if (w.error) return toast('Ошибка: ' + w.error, true)
    version = w.version
    savedContent = ta.value
    toast('Сохранено: ' + entry.name)
  }
  d.setBeforeClose(() => {
    if (confirmedClose || ta.value === savedContent) return true
    askConfirm('Закрыть редактор и потерять несохранённые изменения?', () => {
      confirmedClose = true
      d.close()
    })
    return false
  })
  btns[1].addEventListener('click', save)
  btns[0].addEventListener('click', () => d.close())
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save() }
    if (e.key === 'Escape') d.close()
    if (e.key === 'Tab') {
      e.preventDefault()
      const s = ta.selectionStart
      ta.setRangeText('  ', s, ta.selectionEnd, 'end')
    }
  })
  setTimeout(() => ta.focus(), 30)
}

// Командная палитра (Ctrl+Shift+P)
let paletteEl = null
function paletteItems() {
  const items = []
  for (const t of tabs.values()) items.push({ label: 'Вкладка: ' + t.title, hint: t.type === 'ssh' ? 'SSH' : 'локальная', run: () => activateTab(t.id) })
  items.push({ label: 'Новый локальный терминал', hint: 'Ctrl+Shift+T', run: () => newLocalTab() })
  items.push({ label: 'Новое SSH-подключение', run: () => openSshModal() })
  for (const c of connections) items.push({ label: 'Подключиться: ' + c.name, hint: c.username + '@' + c.host, run: () => connectSaved(c) })
  items.push({ label: 'Сплит вертикальный', hint: 'Ctrl+Shift+D', run: () => splitTab('v') })
  items.push({ label: 'Сплит горизонтальный', hint: 'Ctrl+Shift+E', run: () => splitTab('h') })
  items.push({ label: 'Показать/скрыть боковую панель', run: () => $('#btn-sidebar').click() })
  items.push({ label: 'Настройки', run: () => openSettings() })
  for (const s of settings.snippets || []) items.push({ label: 'Команда: ' + s.name, hint: s.cmd, run: () => {
    const t = tabs.get(activeId)
    if (t) window.api.write(focusedSessId || t.id, s.cmd + (s.enter === false ? '' : '\r'))
  } })
  if (tabs.get(activeId)) items.push({ label: 'Закрыть текущую вкладку', hint: 'Ctrl+Shift+W', run: () => closeTab(activeId, true) })
  return items
}

function closePalette() {
  if (paletteEl) {
    paletteEl.remove()
    paletteEl = null
  }
}

function togglePalette() {
  if (paletteEl) return closePalette()
  const bd = document.createElement('div')
  bd.className = 'palette-backdrop'
  bd.innerHTML = '<div class="palette"><input placeholder="Что сделать? Начни печатать…"><div class="palette-list"></div></div>'
  document.body.appendChild(bd)
  paletteEl = bd
  const inp = bd.querySelector('input')
  const listEl = bd.querySelector('.palette-list')
  const all = paletteItems()
  let filtered = all
  let sel = 0
  const render = () => {
    listEl.innerHTML = ''
    filtered.forEach((it, i) => {
      const row = document.createElement('div')
      row.className = 'palette-item' + (i === sel ? ' sel' : '')
      row.innerHTML = '<span class="pl-label"></span><span class="pl-hint"></span>'
      row.querySelector('.pl-label').textContent = it.label
      row.querySelector('.pl-hint').textContent = it.hint || ''
      row.addEventListener('click', () => { closePalette(); it.run() })
      row.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; render() } })
      listEl.appendChild(row)
    })
    const selEl = listEl.children[sel]
    if (selEl) selEl.scrollIntoView({ block: 'nearest' })
  }
  const filter = () => {
    const q = inp.value.trim().toLowerCase()
    filtered = q ? all.filter((it) => (it.label + ' ' + (it.hint || '')).toLowerCase().includes(q)) : all
    sel = 0
    render()
  }
  inp.addEventListener('input', filter)
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render() }
    else if (e.key === 'Enter') { const it = filtered[sel]; closePalette(); if (it) it.run() }
    else if (e.key === 'Escape') closePalette()
  })
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) closePalette() })
  render()
  setTimeout(() => inp.focus(), 20)
}

// Горячие клавиши v0.7
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
    e.preventDefault()
    splitTab('h')
  } else if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault()
    togglePalette()
  } else if (e.key === 'Escape') {
    closePalette()
  }
}, true)

// ---------- v0.8: настройки-вкладка с категориями, фиксы ----------

// Надёжное копирование в буфер (с запасным вариантом)
function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch {}
  ta.remove()
}
function copyText(text) {
  // v2.1.1: сперва нативный буфер Electron — не зависит от фокуса окна и не «съедает» копирование
  try { window.api.clipboardWrite(text); return } catch {}
  try { navigator.clipboard.writeText(text).catch(() => fallbackCopy(text)) } catch { fallbackCopy(text) }
}

// Настройки теперь открываются как вкладка (перекрывает старую модалку)
function openSettings() { openSettingsTab() }

// Расширенная версия: + насыщенность шрифта и скорость прокрутки; пропускает вкладку настроек
function applySettingsToTerm(tab) {
  if (!tab || tab.type === 'settings') return
  const terms = [tab.term]
  if (tab.split) terms.push(tab.split.term)
  for (const term of terms) {
    term.options.theme = xtermTheme()
    term.options.fontSize = settings.fontSize
    term.options.fontFamily = settings.fontFamily
    term.options.fontWeight = settings.fontWeight || 'normal'
    term.options.fontWeightBold = 'bold'
    term.options.cursorStyle = settings.cursorStyle
    term.options.cursorBlink = settings.cursorBlink
    term.options.scrollback = settings.scrollback
    term.options.lineHeight = settings.lineHeight || 1
    term.options.letterSpacing = settings.letterSpacing || 0
    term.options.scrollSensitivity = settings.scrollSensitivity || 1
  }
  requestAnimationFrame(() => fitTab(tab))
}

function applyAllSettings() {
  void saveSettingsChecked()
  applyBodyTheme()
  for (const t of tabs.values()) applySettingsToTerm(t)
}

function openSettingsTab() {
  if (tabs.get('__settings__')) { activateTab('__settings__'); return }
  const tabEl = document.createElement('div')
  tabEl.className = 'tab'
  tabEl.id = 'terminal-tab-settings'
  tabEl.setAttribute('role', 'tab')
  tabEl.tabIndex = -1
  tabEl.innerHTML = '<span class="tab-badge"><i class=ic-sliders></i></span><span class="tab-title">Настройки</span><button class="tab-close" title="Закрыть"><i class=ic-x></i></button>'
  tabEl.addEventListener('click', () => activateTab('__settings__'))
  tabEl.addEventListener('keydown', (event) => {
    if (event.target === tabEl && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      activateTab('__settings__')
    }
  })
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab('__settings__', false) })
  $('#tabs').appendChild(tabEl)
  const paneEl = document.createElement('div')
  paneEl.className = 'term-pane settings-pane hidden'
  paneEl.setAttribute('role', 'tabpanel')
  paneEl.setAttribute('aria-labelledby', 'terminal-tab-settings')
  $('#terms').appendChild(paneEl)
  const tab = {
    id: '__settings__', type: 'settings', title: 'Настройки', tabEl, paneEl,
    sftpPath: '.', split: null, activeSlot: 'main', sshCfg: null,
    term: { focus() {}, dispose() {}, options: {}, cols: 80, rows: 24 },
  }
  tabs.set('__settings__', tab)
  buildSettingsPane(paneEl)
  activateTab('__settings__')
  updateEmptyState()
}

// Вкладку настроек нельзя сплитить
const __origSplitTab = splitTab
splitTab = function (dir) {
  const t = tabs.get(activeId)
  if (t && t.type === 'settings') return
  __origSplitTab(dir)
}

function settingsPaneHtml() {
  const themeOpts = Object.entries(THEMES)
    .map(([k, t]) => '<option value="' + escapeHtml(k) + '">' + escapeHtml(t.label) + '</option>').join('')
  return `
<div class="settings-wrap">
  <nav class="set-nav">
    <div class="set-nav-title">Настройки</div>
    <input id="st-search" class="set-search" type="search" placeholder="Поиск настроек…" spellcheck="false">
    <div class="set-nav-item active" data-cat="appearance"><i class=ic-brush></i> Внешний вид</div>
    <div class="set-nav-item" data-cat="background"><i class=ic-image></i> Фон</div>
    <div class="set-nav-item" data-cat="terminal"><i class=ic-terminal></i> Терминал</div>
    <div class="set-nav-item" data-cat="ssh"><i class=ic-key></i> SSH</div>
    <div class="set-nav-item" data-cat="hotkeys"><i class=ic-zap></i> Хоткеи</div>
    <div class="set-nav-item" data-cat="experimental"><i class=ic-zap></i> Экспериментальные</div>
    <div class="set-nav-item" data-cat="misc"><i class=ic-grid></i> Прочее</div>
    <div class="set-nav-note">Все изменения применяются и сохраняются сразу</div>
  </nav>
  <div class="set-body">
    <section class="set-section" data-cat="appearance">
      <h2>Внешний вид</h2>
      <div class="set-card">
        <div class="set-row"><label>Тема</label><select id="st-theme">${themeOpts}</select></div>
        <div class="set-row"><label>Эффект ввода текста</label><select id="st-typingfx">
          <option value="glow">Свечение курсора</option>
          <option value="sparks">Искры</option>
          <option value="off">Выключен</option>
        </select></div>
      </div>
      <div class="set-card">
        <div class="set-row"><label>Размер шрифта</label><input id="st-fontsize" type="number" min="8" max="32"></div>
        <div class="set-row"><label>Насыщенность шрифта</label><select id="st-fontweight">
          <option value="normal">Обычная</option>
          <option value="500">Средняя</option>
          <option value="600">Полужирная</option>
          <option value="bold">Жирная</option>
        </select></div>
        <div class="set-row"><label>Межстрочный интервал</label><input id="st-lineheight" type="number" min="1" max="2" step="0.05"></div>
        <div class="set-row"><label>Межбуквенный интервал</label><input id="st-letterspacing" type="number" min="0" max="8" step="0.5"></div>
        <div class="set-row set-col"><label>Шрифт терминала (по приоритету)</label><input id="st-fontfamily" type="text" spellcheck="false"></div>
        <div class="chips">
          <span class="chip" data-font="'Cascadia Code', 'Cascadia Mono', Consolas, monospace">Cascadia Code</span>
          <span class="chip" data-font="'JetBrains Mono', 'Cascadia Code', Consolas, monospace">JetBrains Mono</span>
          <span class="chip" data-font="'Fira Code', 'Cascadia Code', Consolas, monospace">Fira Code</span>
          <span class="chip" data-font="'Cascadia Mono', Consolas, monospace">Cascadia Mono</span>
          <span class="chip" data-font="Consolas, 'Courier New', monospace">Consolas</span>
        </div>
        <div class="set-hint">Шрифт должен быть установлен в Windows. Cascadia Code и JetBrains Mono — бесплатные и выглядят лучше всего.</div>
      </div>
    </section>
    <section class="set-section hidden" data-cat="background">
      <h2>Фоновое изображение</h2>
      <div class="set-card">
        <div class="set-row"><label>Картинка</label><span class="row-btns"><button id="st-bg-pick" class="btn small" type="button">Выбрать…</button><button id="st-bg-clear" class="btn small" type="button">Убрать</button></span></div>
        <div class="set-hint" id="st-bg-path"></div>
        <div class="set-row"><label>Затемнение <b id="st-bgdim-val"></b></label><input id="st-bgdim" type="range" min="0" max="95" step="5"></div>
        <div class="set-row"><label>Размытие <b id="st-bgblur-val"></b></label><input id="st-bgblur" type="range" min="0" max="30" step="1"></div>
      </div>
    </section>
    <section class="set-section hidden" data-cat="terminal">
      <h2>Терминал</h2>
      <div class="set-card">
        <div class="set-row"><label>Шелл по умолчанию</label><select id="st-shell">
          <option value="powershell.exe">PowerShell</option>
          <option value="cmd.exe">cmd</option>
          <option value="custom">Другой…</option>
        </select></div>
        <div class="set-row hidden" id="st-shell-custom-row"><label>Путь к шеллу</label><input id="st-shell-custom" type="text" spellcheck="false" placeholder="например wsl.exe"></div>
        <div class="set-hint">Применяется к новым вкладкам</div>
      </div>
      <div class="set-card">
        <div class="set-row"><label>Стиль курсора</label><select id="st-cursor">
          <option value="block">Блок</option>
          <option value="bar">Палочка</option>
          <option value="underline">Подчёркивание</option>
        </select></div>
        <div class="set-row"><label>Мигание курсора</label><input id="st-blink" type="checkbox"></div>
        <div class="set-row"><label>Плавный курсор-«призрак»</label><input id="st-smoothcursor" type="checkbox"></div>
        <div class="set-row"><label>Плавная анимация текста при вводе и выводе</label><input id="st-smoothtext" type="checkbox"></div>
      </div>
      <div class="set-card">
        <div class="set-row"><label>История прокрутки (строк)</label><input id="st-scrollback" type="number" min="500" max="100000" step="500"></div>
        <div class="set-row"><label>Скорость прокрутки колёсиком</label><input id="st-scrollsens" type="number" min="1" max="10"></div>
        <div class="set-row"><label>Колёсико в полноэкранных программах</label><select id="st-altwheel"><option value="page">PageUp/PageDown (рекомендуется для Claude/Codex)</option><option value="one">По одной стрелке (совместимость)</option><option value="xterm">Стрелками пачкой (режим xterm)</option><option value="off">Отключить</option></select></div>
        <div class="set-row"><label>Копировать при выделении</label><input id="st-copyselect" type="checkbox"></div>
        <div class="set-row"><label>Вставка правой кнопкой мыши</label><input id="st-rightpaste" type="checkbox"></div>
        <div class="set-row"><label>Ctrl+C копирует выделение</label><input id="st-ctrlccopy" type="checkbox"></div>
        <div class="set-hint">Если ничего не выделено — Ctrl+C, как обычно, отправит прерывание в терминал. Ctrl+Shift+C копирует всегда.</div>
        <div class="set-row"><label>Убирать Enter в конце вставки</label><input id="st-pastetrim" type="checkbox"></div>
        <div class="set-row"><label>Вставлять много строк одним блоком</label><input id="st-bracketed" type="checkbox"></div>
        <div class="set-hint">Спасает от «после каждой строки нажимается Enter» (Claude Code и т.п.). Если после включения при вставке появляются лишние символы вроде [200~ — выключи этот пункт.</div>
      </div>
    </section>
    <section class="set-section hidden" data-cat="ssh">
      <h2>SSH</h2>
      <div class="set-card">
        <div class="set-row"><label>Автопереподключение при обрыве</label><input id="st-reconnect" type="checkbox"></div>
        <div class="set-hint">До 5 попыток с нарастающей паузой. Индикатор на вкладке: зелёный — подключено, жёлтый — переподключение, красный — обрыв.</div>
      </div>
    </section>
    <section class="set-section hidden" data-cat="hotkeys">
      <h2>Горячие клавиши</h2>
      <div class="set-card">
        <table class="hk-table">
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd></td><td>Новый терминал</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd></td><td>Закрыть вкладку</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Tab</kbd></td><td>Следующая вкладка</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd></td><td>Сплит вертикальный</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>Сплит горизонтальный</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></td><td>Командная палитра</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>,</kbd></td><td>Настройки</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>Поиск по терминалу</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>V</kbd></td><td>Вставить текст / скриншот / файл</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Закрыть панели и меню</td></tr>
        </table>
      </div>
    </section>
    <section class="set-section hidden" data-cat="experimental">
      <h2>Экспериментальные функции</h2>
      <div class="set-card">
        <div class="set-row"><label>GPU-ускорение (WebGL)</label><input id="st-webgl" type="checkbox"></div>
        <div class="set-hint">WebGL может повысить производительность, но на некоторых драйверах вызывает сбои. Безопасный режим отключает его автоматически.</div>
      </div>
    </section>
    <section class="set-section hidden" data-cat="misc">
      <h2>Прочее</h2>
      <div class="set-card">
        <div class="set-row"><label>Язык интерфейса</label><select id="st-language"><option value="auto">Авто (системный)</option><option value="en">Английский</option><option value="ru">Русский</option></select></div>
        <div class="set-row"><label>Импорт серверов из Tabby</label><button id="st-import-tabby" class="btn small" type="button">Импортировать…</button></div>
      </div>
      <div class="set-card">
        <b>Обновления</b>
        <div class="set-row"><label id="st-update-status">Автоматическая проверка обновлений включена</label><button id="st-update-check" class="btn small" type="button">Проверить</button></div>
        <div class="set-hint">Установщик скачивается только с GitHub Releases и проверяется по SHA-512 перед запуском. Установка выполняется только после подтверждения.</div>
      </div>
      <div class="set-card">
        <b>Данные и диагностика</b>
        <div class="set-row"><label>Экспорт без паролей и ключевых фраз</label><button id="st-export" class="btn small" type="button">Экспортировать…</button></div>
        <div class="set-row"><label>Импорт конфигурации</label><button id="st-import" class="btn small" type="button">Импортировать…</button></div>
        <div class="row-btns set-actions"><button id="st-open-logs" class="btn small" type="button">Открыть логи</button><button id="st-open-dumps" class="btn small" type="button">Открыть дампы</button><button id="st-open-backups" class="btn small" type="button">Открыть резервные копии</button></div>
        <pre id="st-diagnostics" class="diag-output"></pre>
        <div class="set-hint">Телеметрия отсутствует. Диагностика хранится только локально.</div>
      </div>
      <div class="set-card">
        <div class="row-btns set-actions"><button id="st-reset-ui" class="btn" type="button">Сбросить настройки интерфейса</button><button id="st-reset-all" class="btn danger" type="button">Сбросить все данные</button></div>
        <div class="set-row hidden" id="st-safe-row"><label>Безопасный режим GPU</label><button id="st-clear-safe" class="btn small" type="button">Отключить безопасный режим и перезапустить</button></div>
      </div>
      <div class="set-card">
        <div id="st-app-version" class="set-hint">MeowShell v2.3.0-beta.5 · Electron + xterm.js</div>
      </div>
    </section>
  </div>
</div>`
}

function buildSettingsPane(paneEl) {
  paneEl.innerHTML = settingsPaneHtml()
  const q = (sel) => paneEl.querySelector(sel)

  // навигация по категориям
  paneEl.querySelectorAll('.set-nav-item').forEach((el) => {
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    el.addEventListener('click', () => {
      paneEl.querySelectorAll('.set-nav-item').forEach((x) => x.classList.toggle('active', x === el))
      paneEl.querySelectorAll('.set-section').forEach((s) => s.classList.toggle('hidden', s.dataset.cat !== el.dataset.cat))
    })
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click() }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const items = [...paneEl.querySelectorAll('.set-nav-item')]
        const index = items.indexOf(el)
        const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
        if (next) next.focus()
      }
    })
  })
  q('#st-search').addEventListener('input', () => {
    const needle = q('#st-search').value.trim().toLocaleLowerCase()
    if (!needle) {
      const active = paneEl.querySelector('.set-nav-item.active') || paneEl.querySelector('.set-nav-item')
      paneEl.querySelectorAll('.set-section').forEach((section) => section.classList.toggle('hidden', section.dataset.cat !== active.dataset.cat))
      paneEl.querySelectorAll('.set-card').forEach((card) => card.classList.remove('hidden'))
      return
    }
    paneEl.querySelectorAll('.set-section').forEach((section) => {
      let found = false
      section.querySelectorAll('.set-card').forEach((card) => {
        const matches = card.textContent.toLocaleLowerCase().includes(needle)
        card.classList.toggle('hidden', !matches)
        found = found || matches
      })
      section.classList.toggle('hidden', !found)
    })
  })

  // текущие значения
  q('#st-theme').value = THEMES[settings.theme] ? settings.theme : 'dark'
  q('#st-language').value = ['auto', 'en', 'ru'].includes(settings.language) ? settings.language : 'auto'
  q('#st-typingfx').value = settings.typingFx || 'glow'
  q('#st-fontsize').value = settings.fontSize
  q('#st-fontweight').value = String(settings.fontWeight || 'normal')
  q('#st-lineheight').value = settings.lineHeight || 1
  q('#st-letterspacing').value = settings.letterSpacing || 0
  q('#st-fontfamily').value = settings.fontFamily
  q('#st-bg-path').textContent = settings.bgImage || 'Фон не выбран'
  q('#st-bgdim').value = settings.bgDim == null ? 40 : settings.bgDim
  q('#st-bgblur').value = settings.bgBlur || 0
  q('#st-bgdim-val').textContent = q('#st-bgdim').value + '%'
  q('#st-bgblur-val').textContent = q('#st-bgblur').value + 'px'
  const isPreset = settings.shell === 'powershell.exe' || settings.shell === 'cmd.exe'
  q('#st-shell').value = isPreset ? settings.shell : 'custom'
  q('#st-shell-custom').value = isPreset ? '' : settings.shell
  q('#st-shell-custom-row').classList.toggle('hidden', isPreset)
  q('#st-cursor').value = settings.cursorStyle
  q('#st-blink').checked = !!settings.cursorBlink
  q('#st-smoothcursor').checked = settings.smoothCursor !== false
  q('#st-smoothtext').checked = settings.smoothTextAnimation !== false
  q('#st-scrollback').value = settings.scrollback
  q('#st-scrollsens').value = settings.scrollSensitivity || 1
  q('#st-altwheel').value = settings.altWheel || 'page'
  q('#st-copyselect').checked = !!settings.copyOnSelect
  q('#st-rightpaste').checked = settings.rightClickPaste !== false
  q('#st-ctrlccopy').checked = settings.ctrlCCopy !== false
  q('#st-pastetrim').checked = settings.pasteTrimEnd !== false
  q('#st-bracketed').checked = settings.bracketedPaste === 'always'
  q('#st-webgl').checked = settings.webglRenderer === true && !rendererSafeMode
  q('#st-webgl').disabled = rendererSafeMode
  if (rendererSafeMode) q('#st-webgl').title = 'Отключено безопасным режимом после сбоя renderer/GPU'
  q('#st-reconnect').checked = settings.autoReconnect !== false
  q('#st-safe-row').classList.toggle('hidden', !rendererSafeMode)
  renderUpdateSettings()

  // обработчики — всё применяется сразу
  q('#st-theme').addEventListener('change', () => { settings.theme = q('#st-theme').value; applyAllSettings() })
  q('#st-language').addEventListener('change', () => {
    settings.language = q('#st-language').value
    if (window.MeowI18n) window.MeowI18n.setLanguage(settings.language)
    renderUpdateState(updateState)
    applyAllSettings()
  })
  q('#st-typingfx').addEventListener('change', () => { settings.typingFx = q('#st-typingfx').value; applyAllSettings() })
  q('#st-fontsize').addEventListener('change', () => {
    settings.fontSize = Math.min(32, Math.max(8, Number(q('#st-fontsize').value) || 14))
    q('#st-fontsize').value = settings.fontSize
    applyAllSettings()
  })
  q('#st-fontweight').addEventListener('change', () => { settings.fontWeight = q('#st-fontweight').value; applyAllSettings() })
  q('#st-lineheight').addEventListener('change', () => { settings.lineHeight = Math.min(2, Math.max(1, Number(q('#st-lineheight').value) || 1)); applyAllSettings() })
  q('#st-letterspacing').addEventListener('change', () => { settings.letterSpacing = Math.min(8, Math.max(0, Number(q('#st-letterspacing').value) || 0)); applyAllSettings() })
  q('#st-fontfamily').addEventListener('change', () => { settings.fontFamily = q('#st-fontfamily').value.trim() || settings.fontFamily; applyAllSettings() })
  paneEl.querySelectorAll('.chip[data-font]').forEach((chip) => {
    chip.addEventListener('click', () => {
      settings.fontFamily = chip.dataset.font
      q('#st-fontfamily').value = settings.fontFamily
      applyAllSettings()
      toast('Шрифт: ' + chip.textContent)
    })
  })
  q('#st-bg-pick').addEventListener('click', async () => {
    const p = await window.api.pickFile()
    if (!p) return
    const resourceUrl = await window.api.localResourceUrl(p, 'image')
    if (!resourceUrl) return toast('Выбранный файл не является поддерживаемым изображением', true)
    settings.bgImage = p
    backgroundResourceUrl = resourceUrl
    q('#st-bg-path').textContent = p
    applyAllSettings()
  })
  q('#st-bg-clear').addEventListener('click', () => {
    settings.bgImage = ''
    backgroundResourceUrl = ''
    q('#st-bg-path').textContent = 'Фон не выбран'
    applyAllSettings()
  })
  q('#st-bgdim').addEventListener('input', () => { settings.bgDim = Number(q('#st-bgdim').value); q('#st-bgdim-val').textContent = settings.bgDim + '%'; applyBackground() })
  q('#st-bgdim').addEventListener('change', applyAllSettings)
  q('#st-bgblur').addEventListener('input', () => { settings.bgBlur = Number(q('#st-bgblur').value); q('#st-bgblur-val').textContent = settings.bgBlur + 'px'; applyBackground() })
  q('#st-bgblur').addEventListener('change', applyAllSettings)
  const applyShell = () => {
    const v = q('#st-shell').value
    q('#st-shell-custom-row').classList.toggle('hidden', v !== 'custom')
    settings.shell = v === 'custom' ? (q('#st-shell-custom').value.trim() || 'powershell.exe') : v
    applyAllSettings()
  }
  q('#st-shell').addEventListener('change', applyShell)
  q('#st-shell-custom').addEventListener('change', applyShell)
  q('#st-cursor').addEventListener('change', () => { settings.cursorStyle = q('#st-cursor').value; applyAllSettings() })
  q('#st-blink').addEventListener('change', () => { settings.cursorBlink = q('#st-blink').checked; applyAllSettings() })
  q('#st-smoothcursor').addEventListener('change', () => { settings.smoothCursor = q('#st-smoothcursor').checked; applyAllSettings() })
  q('#st-smoothtext').addEventListener('change', () => { settings.smoothTextAnimation = q('#st-smoothtext').checked; applyAllSettings() })
  q('#st-scrollback').addEventListener('change', () => { settings.scrollback = Math.min(100000, Math.max(500, Number(q('#st-scrollback').value) || 5000)); applyAllSettings() })
  q('#st-scrollsens').addEventListener('change', () => { settings.scrollSensitivity = Math.min(10, Math.max(1, Number(q('#st-scrollsens').value) || 1)); applyAllSettings() })
  q('#st-altwheel').addEventListener('change', () => { settings.altWheel = q('#st-altwheel').value; applyAllSettings() })
  q('#st-copyselect').addEventListener('change', () => { settings.copyOnSelect = q('#st-copyselect').checked; applyAllSettings() })
  q('#st-rightpaste').addEventListener('change', () => { settings.rightClickPaste = q('#st-rightpaste').checked; applyAllSettings() })
  q('#st-ctrlccopy').addEventListener('change', () => { settings.ctrlCCopy = q('#st-ctrlccopy').checked; applyAllSettings() })
  q('#st-pastetrim').addEventListener('change', () => { settings.pasteTrimEnd = q('#st-pastetrim').checked; applyAllSettings() })
  q('#st-bracketed').addEventListener('change', () => { settings.bracketedPaste = q('#st-bracketed').checked ? 'always' : 'auto'; applyAllSettings() })
  q('#st-webgl').addEventListener('change', () => {
    settings.webglRenderer = !rendererSafeMode && q('#st-webgl').checked
    applyAllSettings()
  })
  q('#st-reconnect').addEventListener('change', () => { settings.autoReconnect = q('#st-reconnect').checked; applyAllSettings() })
  q('#st-import-tabby').addEventListener('click', async () => {
    const r = await window.api.importTabby()
    if (!r || r.canceled) return
    if (r.error) return toast('Импорт: ' + r.error, true)
    connections = (r.view && r.view.connections) || connections
    renderConnections()
    toast(r.added ? 'Импортировано серверов: ' + r.added + '. Пароли Tabby не отдаёт — введи их при первом входе' : 'Новых серверов не найдено')
  })
  q('#st-update-check').addEventListener('click', async () => {
    try {
      dismissedUpdateKey = ''
      renderUpdateState(await window.api.checkForUpdates())
    } catch (err) {
      toast(uiText('Update error: ', 'Ошибка обновления: ') + (err && err.message ? err.message : err), true)
    }
  })

  const showDiagnostics = async () => {
    const d = await window.api.getDiagnostics()
    q('#st-diagnostics').textContent = [
      'MeowShell ' + d.appVersion,
      'Electron ' + d.electron + ' · Chromium ' + d.chromium + ' · Node ' + d.node,
      d.platform + ' ' + d.architecture + ' · OS ' + d.osRelease,
      'Local PTY: ' + (d.localPty ? 'OK' : 'unavailable'),
      'GPU safe mode: ' + (d.safeMode ? 'enabled' : 'disabled'),
      'Telemetry: disabled',
      'Config: ' + d.paths.config,
      'Logs: ' + d.paths.logs,
      'Crash dumps: ' + d.paths.crashDumps,
    ].join('\n')
  }
  showDiagnostics().catch((err) => { q('#st-diagnostics').textContent = err.message })

  q('#st-export').addEventListener('click', async () => {
    const r = await window.api.exportConfig()
    if (!r || r.canceled) return
    toast(r.error ? 'Ошибка: ' + r.error : 'Сохранено: ' + r.path, !!r.error)
  })
  q('#st-import').addEventListener('click', async () => {
    const preview = await window.api.importConfigPreview()
    if (!preview || preview.canceled) return
    if (preview.error) return toast('Импорт: ' + preview.error, true)
    const d = makeDialog('<h2>Импорт конфигурации</h2><p class="confirm-text"></p><div class="modal-actions"><button class="btn ghost" data-mode="cancel">Отмена</button><button class="btn" data-mode="replace">Заменить</button><button class="btn primary" data-mode="merge">Объединить</button></div>')
    d.m.querySelector('.confirm-text').textContent = uiText(
      preview.connections + ' connection(s), ' + preview.settings + ' setting(s). Passwords and passphrases are never imported.',
      'Подключений: ' + preview.connections + ', настроек: ' + preview.settings + '. Пароли и ключевые фразы никогда не импортируются.'
    )
    d.m.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', async () => {
      const mode = button.dataset.mode
      d.close()
      if (mode === 'cancel') return
      const r = await window.api.applyConfigImport(preview.token, mode)
      if (r.error) return toast('Импорт: ' + r.error, true)
      window.api.restartApp()
    }))
  })
  q('#st-open-logs').addEventListener('click', () => window.api.openDiagnosticsPath('logs'))
  q('#st-open-dumps').addEventListener('click', () => window.api.openDiagnosticsPath('crashDumps'))
  q('#st-open-backups').addEventListener('click', () => window.api.openDiagnosticsPath('backups'))
  q('#st-reset-ui').addEventListener('click', () => askConfirm('Сбросить настройки интерфейса? Перед сбросом будет создана резервная копия.', async () => {
    const r = await window.api.resetConfig('settings')
    if (r.error) return toast('Ошибка: ' + r.error, true)
    window.api.restartApp()
  }))
  q('#st-reset-all').addEventListener('click', () => askConfirm('Безвозвратно удалить настройки, серверы, известные SSH-ключи хостов, резервные копии, логи и дампы? Резервная копия не создаётся.', async () => {
    const r = await window.api.resetConfig('all')
    if (r.error) return toast('Ошибка: ' + r.error, true)
    window.api.restartApp()
  }))
  q('#st-clear-safe').addEventListener('click', async () => {
    const r = await window.api.clearSafeMode()
    if (r.error) return toast('Ошибка: ' + r.error, true)
    window.api.restartApp()
  })
}

// Вставка правой кнопкой мыши в терминал (как в PuTTY)
document.addEventListener('contextmenu', (e) => {
  if (settings.rightClickPaste === false) return
  if (!e.target.closest || !e.target.closest('.xterm')) return
  e.preventDefault()
  e.stopPropagation()
  const cell = e.target.closest('.split-cell')
  if (cell && cell.dataset.sessionId && paneOf.has(cell.dataset.sessionId)) {
    focusedSessId = cell.dataset.sessionId
    const pane = paneOf.get(focusedSessId)
    if (pane) pane.tab.activeSlot = pane.slot
  }
  handlePaste()
})

// Ctrl+, — настройки
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ',') {
    e.preventDefault()
    openSettingsTab()
  }
})

// ---------- v0.9: broadcast, вставка, мониторинг, туннели, ключи, темы, quake, восстановление ----------

// === Broadcast-ввод ===
let broadcastOn = false

function routeInput(sessId, data) {
  if (!broadcastOn) return window.api.write(sessId, data)
  const scope = settings.broadcastScope || 'splits'
  const at = tabs.get(activeId)
  const ids = new Set([sessId])
  for (const [sid, p] of paneOf) {
    if (sid === '__settings__' || !p.tab || p.tab.type === 'settings') continue
    if (scope === 'all' || (at && p.tab === at)) ids.add(sid)
  }
  for (const i of ids) window.api.write(i, data)
}

function toggleBroadcast() {
  broadcastOn = !broadcastOn
  btnBroadcast.classList.toggle('bcast-on', broadcastOn)
  document.body.classList.toggle('broadcast-on', broadcastOn)
  if (broadcastOn) {
    toast('Broadcast ВКЛ: ввод идёт ' + ((settings.broadcastScope || 'splits') === 'all' ? 'во все вкладки' : 'во все сплиты вкладки'))
  } else {
    toast('Broadcast выключен')
  }
}

// === кнопки в таббаре ===
function v9MkBtn(id, txt, title, onClick) {
  const ref = $('#btn-split')
  const b = document.createElement('button')
  b.id = id
  b.className = ref.className.replace(/\bhidden\b/, '').trim()
  b.innerHTML = txt
  b.title = title
  b.addEventListener('click', onClick)
  ref.parentNode.insertBefore(b, ref)
  return b
}
const btnBroadcast = v9MkBtn('btn-broadcast', '<i class=ic-broadcast></i>', 'Broadcast-ввод (Ctrl+Shift+B)', () => toggleBroadcast())
const btnMonitor = v9MkBtn('btn-monitor', '<i class=ic-chart></i>', 'Мониторинг сервера: CPU/RAM/диск', () => toggleMonitor())
const btnTunnels = v9MkBtn('btn-tunnels', '<i class=ic-tunnel></i>', 'SSH-туннели (порт-форвардинг)', () => openTunnels())
btnMonitor.classList.add('hidden')
btnTunnels.classList.add('hidden')

const __v9ActivateTab = activateTab
activateTab = function (id) {
  __v9ActivateTab(id)
  const t = tabs.get(id)
  const ssh = !!(t && t.type === 'ssh')
  btnMonitor.classList.toggle('hidden', !ssh)
  btnTunnels.classList.toggle('hidden', !ssh)
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') {
    e.preventDefault()
    toggleBroadcast()
  }
}, true)

// === безопасная многострочная вставка ===
function safePaste(id, text, term) {
  const doIt = (raw) => {
    let t = String(raw)
    if (settings.pasteTrimEnd !== false) t = t.replace(/[\r\n]+$/, '')
    if (!t) return
    if (settings.bracketedPaste === 'always' && /[\r\n]/.test(t)) {
      // принудительный bracketed paste: весь текст одним блоком, без выполнения строк
      window.api.write(id, '\x1b[200~' + t.replace(/\r\n|\r|\n/g, '\r') + '\x1b[201~')
    } else if (term && term.paste) term.paste(t)
    else window.api.write(id, t)
  }
  const lines = String(text).split(/\r\n|\r|\n/)
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  if (settings.pasteGuard === false || lines.length <= 1) return doIt(text)
  const d = makeDialog('<h2><i class=ic-shield></i> Вставка ' + lines.length + ' строк</h2>' +
    '<div class="set-hint">Каждый перевод строки может выполнить команду. Проверь содержимое:</div>' +
    '<pre class="paste-preview"></pre>' +
    '<div class="modal-actions"><button class="btn ghost">Отмена</button><button class="btn">Одной строкой</button><button class="btn primary">Вставить как есть</button></div>')
  d.m.querySelector('.paste-preview').textContent = lines.slice(0, 15).join('\n') + (lines.length > 15 ? '\n… ещё ' + (lines.length - 15) + ' строк' : '')
  const btns = d.m.querySelectorAll('.modal-actions .btn')
  btns[0].addEventListener('click', () => d.close())
  btns[1].addEventListener('click', () => { d.close(); doIt(lines.map((l) => l.trim()).join(' ')) })
  btns[2].addEventListener('click', () => { d.close(); doIt(text) })
}

// Нативный пункт «Вставить» и системные сочетания также проходят через
// pasteGuard. Обработчик capture срабатывает раньше внутреннего textarea xterm.
document.addEventListener('paste', (event) => {
  const xterm = event.target && event.target.closest && event.target.closest('.xterm')
  if (!xterm) return
  const cell = xterm.closest('.split-cell')
  const id = cell && cell.dataset.sessionId
  const pane = id && paneOf.get(id)
  if (!pane) return
  const term = pane.slot === 'split' && pane.tab.split ? pane.tab.split.term : pane.tab.term
  const text = event.clipboardData && event.clipboardData.getData('text/plain')
  event.preventDefault()
  event.stopImmediatePropagation()
  if (text) safePaste(id, text, term)
}, true)

// === мониторинг сервера ===
function v9bytes(n) {
  if (!isFinite(n) || n < 0) return '?'
  const u = window.MeowI18n && window.MeowI18n.language() === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] : ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i]
}

function v9up(s) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return (d ? d + uiText('d ', 'д ') : '') + h + uiText('h ', 'ч ') + m + uiText('m', 'м')
}

function toggleMonitor(tab) {
  tab = tab || tabs.get(activeId)
  if (!tab || tab.type !== 'ssh') return toast('Мониторинг работает на SSH-вкладках', true)
  if (tab.monBar) {
    window.api.monitorStop(tab.id)
    tab.monBar.remove()
    tab.monBar = null
    return
  }
  const bar = document.createElement('div')
  bar.className = 'monitor-bar'
  bar.textContent = 'сбор данных…'
  tab.paneEl.appendChild(bar)
  tab.monBar = bar
  window.api.monitorStart(tab.id, (settings.monitorInterval || 3) * 1000)
}

window.api.onMonitorData((d) => {
  const p = paneOf.get(d.id)
  const tab = p && p.tab
  if (!tab || !tab.monBar) return
  const bits = []
  if (typeof d.cpu === 'number') bits.push('CPU ' + d.cpu + '%')
  if (d.memTotal) bits.push('RAM ' + v9bytes(d.memUsed) + ' / ' + v9bytes(d.memTotal))
  if (d.diskTotal) bits.push('SSD ' + v9bytes(d.diskUsed) + ' / ' + v9bytes(d.diskTotal))
  if (d.uptime) bits.push('up ' + v9up(d.uptime))
  tab.monBar.textContent = bits.length ? bits.join(' · ') : 'нет данных (не Linux?)'
})

// === SSH-туннели ===
const runningTunnels = new Set()

function tunKey(tabId, t) { return tabId + ':' + t.localPort }

async function startTunnel(tabId, t, silent) {
  const r = await window.api.tunnelStart({ id: tabId, localPort: +t.localPort, remoteHost: t.remoteHost || '127.0.0.1', remotePort: +t.remotePort })
  if (r && r.error) {
    if (!silent) toast('Туннель: ' + r.error, true)
    return false
  }
  runningTunnels.add(tunKey(tabId, t))
  toast('Туннель: localhost:' + t.localPort + ' → ' + (t.remoteHost || '127.0.0.1') + ':' + t.remotePort)
  return true
}

async function stopTunnelRow(tabId, t) {
  const result = await window.api.tunnelStop({ id: tabId, localPort: +t.localPort })
  if (result && result.error) {
    toast('Туннель: ' + result.error, true)
    return false
  }
  runningTunnels.delete(tunKey(tabId, t))
  return true
}

function openTunnels() {
  const tab = tabs.get(activeId)
  if (!tab || tab.type !== 'ssh') return toast('Туннели работают через активную SSH-вкладку', true)
  const conn = tab.sshCfg && tab.sshCfg.id ? connections.find((c) => c.id === tab.sshCfg.id) : null
  const store = conn || tab.sshCfg || {}
  store.tunnels = store.tunnels || []
  const d = makeDialog('<h2><i class=ic-tunnel></i> SSH-туннели</h2>' +
    '<div class="set-hint">Локальный порт на этом ПК пробрасывается на адрес, видимый с сервера. Туннель живёт, пока открыта эта SSH-вкладка.</div>' +
    '<div id="tun-list"></div>' +
    '<div class="tun-form"><input id="tun-lp" type="number" placeholder="Лок. порт"><span>→</span><input id="tun-rh" type="text" placeholder="127.0.0.1"><input id="tun-rp" type="number" placeholder="Порт сервера"><label><input id="tun-auto" type="checkbox"> авто</label><button class="btn primary" id="tun-add">Добавить</button></div>' +
    '<div class="set-hint">Пример: 5432 → 127.0.0.1 : 5432 — база на сервере станет доступна как localhost:5432. «Авто» — запускать при подключении.</div>' +
    '<div class="modal-actions"><button class="btn ghost" id="tun-close">Закрыть</button></div>')
  const save = async () => {
    if (!conn) return true
    const result = await window.api.saveConnection(conn)
    if (!result || result.error) {
      toast('Туннели не сохранены: ' + (result && result.error || 'пустой ответ приложения'), true)
      return false
    }
    connections = result.connections || connections
    const persisted = connections.find((item) => item.id === conn.id)
    if (persisted) {
      store.tunnels = persisted.tunnels || []
      tab.sshCfg = persisted
    }
    return true
  }
  const render = () => {
    const list = d.m.querySelector('#tun-list')
    list.innerHTML = ''
    if (!store.tunnels.length) {
      list.innerHTML = '<div class="set-hint">Пока нет туннелей — добавь ниже.</div>'
      return
    }
    store.tunnels.forEach((t, i) => {
      const on = runningTunnels.has(tunKey(tab.id, t))
      const row = document.createElement('div')
      row.className = 'tun-row'
      row.innerHTML = '<span class="tun-dot' + (on ? ' on' : '') + '"></span><span class="tun-desc"></span>' +
        (t.auto ? '<span class="tun-auto">авто</span>' : '') +
        '<span class="spacer"></span><button class="btn small tun-toggle">' + (on ? 'Стоп' : 'Запустить') + '</button><button class="btn small tun-del" title="Удалить"><i class=ic-x></i></button>'
      row.querySelector('.tun-desc').textContent = 'localhost:' + t.localPort + ' → ' + (t.remoteHost || '127.0.0.1') + ':' + t.remotePort
      row.querySelector('.tun-toggle').addEventListener('click', async () => {
        if (on) {
          if (!await stopTunnelRow(tab.id, t)) return
        } else if (!await startTunnel(tab.id, t)) return
        render()
      })
      row.querySelector('.tun-del').addEventListener('click', async () => {
        if (on && !await stopTunnelRow(tab.id, t)) return
        const removed = store.tunnels.splice(i, 1)[0]
        if (!await save()) {
          store.tunnels.splice(i, 0, removed)
          return
        }
        render()
      })
      list.appendChild(row)
    })
  }
  d.m.querySelector('#tun-add').addEventListener('click', async () => {
    const lp = +d.m.querySelector('#tun-lp').value
    const rp = +d.m.querySelector('#tun-rp').value
    const rh = d.m.querySelector('#tun-rh').value.trim() || '127.0.0.1'
    if (!Number.isInteger(lp) || lp < 1 || lp > 65535 || !Number.isInteger(rp) || rp < 1 || rp > 65535) {
      return toast('Укажи корректные порты от 1 до 65535', true)
    }
    if (!/^[\p{L}\p{N}._:+-]+$/u.test(rh) || rh.startsWith('-')) return toast('Укажи корректный адрес назначения', true)
    store.tunnels.push({ localPort: lp, remoteHost: rh, remotePort: rp, auto: d.m.querySelector('#tun-auto').checked })
    if (!await save()) {
      store.tunnels.pop()
      return
    }
    render()
  })
  d.m.querySelector('#tun-close').addEventListener('click', () => d.close())
  render()
}

// === SSH-ключи ===
function keygenDialog() {
  const d = makeDialog('<h2><i class=ic-key></i> Новый SSH-ключ</h2>' +
    '<div class="set-row"><label>Тип</label><select id="kg-type"><option value="ed25519">ed25519 (рекомендуется)</option><option value="rsa">RSA 4096</option></select></div>' +
    '<div class="set-row"><label>Комментарий</label><input id="kg-comment" type="text" placeholder="meowshell@pc"></div>' +
    '<div class="set-row"><label>Пароль ключа</label><input id="kg-pass" type="password" placeholder="можно оставить пустым"></div>' +
    '<div class="modal-actions"><button class="btn ghost">Отмена</button><button class="btn primary">Создать…</button></div>')
  const btns = d.m.querySelectorAll('.modal-actions .btn')
  btns[0].addEventListener('click', () => d.close())
  btns[1].addEventListener('click', async () => {
    const r = await window.api.sshKeygen({
      type: d.m.querySelector('#kg-type').value,
      comment: d.m.querySelector('#kg-comment').value.trim(),
      passphrase: d.m.querySelector('#kg-pass').value,
    })
    if (r && r.error) return toast('Ключ: ' + r.error, true)
    if (!r || r.canceled) return
    d.close()
    const d2 = makeDialog('<h2><i class=ic-check></i> Ключ создан</h2>' +
      '<div class="set-hint" id="kg-paths"></div>' +
      '<pre class="paste-preview" id="kg-pub"></pre>' +
      '<div class="modal-actions"><button class="btn" id="kg-copy">Копировать публичный</button><button class="btn primary" id="kg-ok">Готово</button></div>')
    d2.m.querySelector('#kg-paths').textContent = 'Приватный: ' + r.privatePath + ' (никому не показывай). Публичный: ' + r.publicPath
    d2.m.querySelector('#kg-pub').textContent = r.publicKey
    d2.m.querySelector('#kg-copy').addEventListener('click', () => copyText(r.publicKey))
    d2.m.querySelector('#kg-ok').addEventListener('click', () => d2.close())
  })
}

async function installKeyOnServer() {
  const tab = tabs.get(activeId) && tabs.get(activeId).type === 'ssh'
    ? tabs.get(activeId)
    : tabs.get(lastSshSessionId)
  if (!tab || tab.type !== 'ssh') return toast('Открой SSH-вкладку нужного сервера', true)
  toast('Выбери публичный ключ (файл .pub)')
  const p = await window.api.pickFile()
  if (!p) return
  const r = await window.api.sshInstallKey({ id: tab.id, pubPath: p })
  if (r && r.error) return toast('Не удалось: ' + r.error, true)
  toast('Ключ добавлен в authorized_keys — теперь можно входить по ключу')
}

// === свои темы ===
const ANSI16 = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']

function v9hex(c) {
  c = String(c || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7)
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
  const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('')
  return '#000000'
}

function v9cssVar(name) {
  return (getComputedStyle(document.body).getPropertyValue(name) || getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim()
}

function mergeCustomThemes() {
  for (const [k, v] of Object.entries(settings.customThemes || {})) {
    THEMES[k] = { label: v.label, xterm: v.xterm, ui: v.ui, custom: true }
  }
}

function applyBodyTheme() {
  const keep = ['sidebar-hidden', 'has-bg', 'broadcast-on'].filter((c) => document.body.classList.contains(c))
  const th = THEMES[settings.theme]
  const isCustom = !!(th && th.custom)
  document.body.className = 'theme-' + (isCustom ? 'dark' : (th ? settings.theme : 'dark'))
  for (const c of keep) document.body.classList.add(c)
  const bs = document.body.style
  const map = { bg: '--bg', bg2: '--bg2', bg3: '--bg3', border: '--border', fg: '--fg', fgDim: '--fg-dim', accent: '--accent' }
  for (const v of Object.values(map)) bs.removeProperty(v)
  if (isCustom && th.ui) {
    for (const [k, cssVar] of Object.entries(map)) {
      if (th.ui[k]) bs.setProperty(cssVar, th.ui[k])
    }
  }
  applyBackground()
}

function refreshThemeSelect() {
  const sel = document.getElementById('st-theme')
  if (!sel) return
  sel.innerHTML = ''
  for (const [key, theme] of Object.entries(THEMES)) {
    const option = document.createElement('option')
    option.value = key
    option.textContent = theme.label || key
    sel.appendChild(option)
  }
  sel.value = THEMES[settings.theme] ? settings.theme : 'dark'
}

function openThemeEditor(key) {
  const existing = key && settings.customThemes && settings.customThemes[key]
  const baseX = existing ? existing.xterm : ((THEMES[settings.theme] || THEMES.dark).xterm || {})
  const baseUI = existing ? existing.ui : {
    bg: v9cssVar('--bg'), bg2: v9cssVar('--bg2'), bg3: v9cssVar('--bg3'), border: v9cssVar('--border'),
    fg: v9cssVar('--fg'), fgDim: v9cssVar('--fg-dim'), accent: v9cssVar('--accent'),
  }
  const uiFields = [['bg', 'Фон окна'], ['bg2', 'Панели'], ['bg3', 'Элементы'], ['border', 'Рамки'], ['fg', 'Текст'], ['fgDim', 'Тусклый текст'], ['accent', 'Акцент']]
  const termFields = [['background', 'Фон терминала'], ['foreground', 'Текст'], ['cursor', 'Курсор'], ['selectionBackground', 'Выделение']]
  let html = '<h2><i class=ic-brush></i> ' + (existing ? 'Изменить тему' : 'Новая тема') + '</h2>'
  html += '<div class="set-row"><label>Название</label><input id="ct-name" type="text"></div>'
  html += '<b>Интерфейс</b><div class="color-row">' + uiFields.map((f) => '<label>' + f[1] + '<input type="color" data-ui="' + f[0] + '"></label>').join('') + '</div>'
  html += '<b>Терминал</b><div class="color-row">' + termFields.map((f) => '<label>' + f[1] + '<input type="color" data-x="' + f[0] + '"></label>').join('') + '</div>'
  html += '<b>16 цветов ANSI</b><div class="ansi-grid">' + ANSI16.map((k) => '<label>' + k.replace('bright', 'ярк.') + '<input type="color" data-x="' + k + '"></label>').join('') + '</div>'
  html += '<div class="modal-actions"><button class="btn ghost">Отмена</button><button class="btn primary">Сохранить и применить</button></div>'
  const d = makeDialog(html)
  d.m.classList.add('modal-wide')
  d.m.querySelector('#ct-name').value = existing ? existing.label : 'Моя тема'
  d.m.querySelectorAll('[data-ui]').forEach((inp) => { inp.value = v9hex(baseUI[inp.dataset.ui]) })
  const defs = { background: v9hex(baseUI.bg), foreground: v9hex(baseUI.fg), cursor: '#ffffff', selectionBackground: '#3355aa', black: '#000000', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d0d0d0', brightBlack: '#5c6370', brightRed: '#ff7a85', brightGreen: '#b5e890', brightYellow: '#f0d197', brightBlue: '#80c7ff', brightMagenta: '#d7a1e7', brightCyan: '#7bdfe8', brightWhite: '#ffffff' }
  d.m.querySelectorAll('[data-x]').forEach((inp) => { inp.value = v9hex(baseX[inp.dataset.x] || defs[inp.dataset.x]) })
  const btns = d.m.querySelectorAll('.modal-actions .btn')
  btns[0].addEventListener('click', () => d.close())
  btns[1].addEventListener('click', async () => {
    const label = d.m.querySelector('#ct-name').value.trim() || 'Моя тема'
    const ui = {}
    const xt = {}
    d.m.querySelectorAll('[data-ui]').forEach((inp) => { ui[inp.dataset.ui] = inp.value })
    d.m.querySelectorAll('[data-x]').forEach((inp) => { xt[inp.dataset.x] = inp.value })
    const k = key || 'custom-' + Date.now().toString(36)
    settings.customThemes = settings.customThemes || {}
    settings.customThemes[k] = { label, ui, xterm: xt }
    mergeCustomThemes()
    settings.theme = k
    if (!await saveSettingsChecked()) return
    applyAllSettings()
    refreshThemeSelect()
    renderCustomThemesList()
    d.close()
    toast('Тема «' + label + '» применена')
  })
}

function renderCustomThemesList() {
  const box = document.getElementById('ct-list')
  if (!box) return
  const cts = Object.entries(settings.customThemes || {})
  box.innerHTML = cts.length ? '' : '<div class="set-hint">Своих тем пока нет — создай первую ниже.</div>'
  for (const [k, v] of cts) {
    const row = document.createElement('div')
    row.className = 'ct-row'
    row.innerHTML = '<span class="ct-name"></span><span class="spacer"></span><button class="btn small ct-apply">Применить</button><button class="btn small ct-edit">Изменить</button><button class="btn small ct-del"><i class=ic-x></i></button>'
    row.querySelector('.ct-name').textContent = v.label + (settings.theme === k ? ' · активна' : '')
    row.querySelector('.ct-apply').addEventListener('click', async () => {
      settings.theme = k
      if (!await saveSettingsChecked()) return
      applyAllSettings()
      refreshThemeSelect()
      renderCustomThemesList()
    })
    row.querySelector('.ct-edit').addEventListener('click', () => openThemeEditor(k))
    row.querySelector('.ct-del').addEventListener('click', async () => {
      delete settings.customThemes[k]
      delete THEMES[k]
      if (settings.theme === k) settings.theme = 'dark'
      if (!await saveSettingsChecked()) return
      applyAllSettings()
      refreshThemeSelect()
      renderCustomThemesList()
    })
    box.appendChild(row)
  }
}

// === новые категории в настройках ===
function injectV9Settings(pane) {
  const nav = pane.querySelector('.set-nav')
  const body = pane.querySelector('.set-body')
  if (!nav || !body || pane.querySelector('.set-section[data-cat="features"]')) return
  const note = nav.querySelector('.set-nav-note')
  const mkNav = (cat, label) => {
    const el = document.createElement('div')
    el.className = 'set-nav-item'
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    el.dataset.cat = cat
    el.innerHTML = label
    el.addEventListener('click', () => {
      pane.querySelectorAll('.set-nav-item').forEach((x) => x.classList.toggle('active', x === el))
      pane.querySelectorAll('.set-section').forEach((s) => s.classList.toggle('hidden', s.dataset.cat !== cat))
    })
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click() }
    })
    nav.insertBefore(el, note)
  }
  mkNav('features', '<i class=ic-star></i> Фичи')
  mkNav('mythemes', '<i class=ic-brush></i> Мои темы')
  body.insertAdjacentHTML('beforeend',
    '<section class="set-section hidden" data-cat="features"><h2>Фичи</h2>' +
    '<div class="set-card"><b><i class=ic-zap></i> Quake-режим</b>' +
    '<div class="set-row"><label>Включён</label><input type="checkbox" id="st-quake"></div>' +
    '<div class="set-row"><label>Глобальный хоткей</label><select id="st-quake-key"><option value="CommandOrControl+`">Ctrl + ` (ё)</option><option value="Control+Shift+Q">Ctrl + Shift + Q</option><option value="Control+Alt+T">Ctrl + Alt + T</option><option value="F1">F1</option></select></div>' +
    '<div class="set-row"><label>Прилипать к верху экрана</label><input type="checkbox" id="st-quake-dock"></div>' +
    '<div class="set-row"><label>Высота окна</label><input type="range" id="st-quake-h" min="30" max="100" step="5"><span id="st-quake-h-val"></span></div>' +
    '<div class="set-hint">Хоткей работает из любой программы: терминал выезжает сверху поверх окон, повторное нажатие прячет его.</div></div>' +
    '<div class="set-card"><b><i class=ic-save></i> Вкладки</b>' +
    '<div class="set-row"><label>Восстанавливать вкладки при запуске</label><input type="checkbox" id="st-restore"></div>' +
    '<div class="set-hint">SSH-вкладки восстанавливаются только для серверов с сохранённым паролем или ключом.</div></div>' +
    '<div class="set-card"><b><i class=ic-broadcast></i> Broadcast-ввод</b>' +
    '<div class="set-row"><label>Куда отправлять ввод</label><select id="st-bcast"><option value="splits">Во все сплиты текущей вкладки</option><option value="all">Во все вкладки сразу</option></select></div>' +
    '<div class="set-hint">Вкл/выкл: кнопка <i class=ic-broadcast></i> или Ctrl+Shift+B. Пока включён — вокруг терминала красная рамка.</div></div>' +
    '<div class="set-card"><b><i class=ic-shield></i> Вставка</b>' +
    '<div class="set-row"><label>Предупреждать при вставке нескольких строк</label><input type="checkbox" id="st-pasteguard"></div></div>' +
    '<div class="set-card"><b><i class=ic-chart></i> Мониторинг сервера</b>' +
    '<div class="set-row"><label>Интервал обновления</label><select id="st-mon-int"><option value="2">2 сек</option><option value="3">3 сек</option><option value="5">5 сек</option><option value="10">10 сек</option></select></div>' +
    '<div class="set-hint">Кнопка <i class=ic-chart></i> на SSH-вкладке показывает CPU / RAM / диск / аптайм (для Linux-серверов).</div></div>' +
    '</section>' +
    '<section class="set-section hidden" data-cat="mythemes"><h2>Мои темы</h2>' +
    '<div class="set-card"><div id="ct-list"></div><div class="row-btns"><button class="btn primary" id="ct-new">Создать на основе текущей</button></div>' +
    '<div class="set-hint">Тема меняет и интерфейс, и цвета терминала. Созданные темы появляются в общем списке тем.</div></div></section>')
  const sshSec = body.querySelector('.set-section[data-cat="ssh"]')
  if (sshSec && !sshSec.querySelector('#st-keygen')) {
    sshSec.insertAdjacentHTML('beforeend',
      '<div class="set-card"><b><i class=ic-key></i> SSH-ключи</b>' +
      '<div class="row-btns"><button class="btn" id="st-keygen">Создать ключ…</button><button class="btn" id="st-installkey">Установить ключ на сервер активной вкладки…</button></div>' +
      '<div class="set-hint">С ключом вход без пароля: приватный файл указываешь в форме подключения, публичный (.pub) — устанавливаешь на сервер.</div></div>')
  }
  const q = (s) => pane.querySelector(s)
  q('#st-quake').checked = settings.quakeEnabled === true
  q('#st-quake-key').value = settings.quakeHotkey || 'CommandOrControl+`'
  q('#st-quake-dock').checked = settings.quakeDock !== false
  q('#st-quake-h').value = settings.quakeHeight || 50
  q('#st-quake-h-val').textContent = (settings.quakeHeight || 50) + '%'
  q('#st-restore').checked = settings.restoreTabs === true
  q('#st-bcast').value = settings.broadcastScope || 'splits'
  q('#st-pasteguard').checked = settings.pasteGuard !== false
  q('#st-mon-int').value = String(settings.monitorInterval || 3)
  const save = async () => {
    if (!await saveSettingsChecked()) return false
    applyAllSettings()
    return true
  }
  q('#st-quake').addEventListener('change', () => { settings.quakeEnabled = q('#st-quake').checked; save() })
  q('#st-quake-key').addEventListener('change', () => { settings.quakeHotkey = q('#st-quake-key').value; save() })
  q('#st-quake-dock').addEventListener('change', () => { settings.quakeDock = q('#st-quake-dock').checked; save() })
  q('#st-quake-h').addEventListener('input', () => { q('#st-quake-h-val').textContent = q('#st-quake-h').value + '%' })
  q('#st-quake-h').addEventListener('change', () => { settings.quakeHeight = +q('#st-quake-h').value; save() })
  q('#st-restore').addEventListener('change', () => { settings.restoreTabs = q('#st-restore').checked; save() })
  q('#st-bcast').addEventListener('change', () => { settings.broadcastScope = q('#st-bcast').value; save() })
  q('#st-pasteguard').addEventListener('change', () => { settings.pasteGuard = q('#st-pasteguard').checked; save() })
  q('#st-mon-int').addEventListener('change', () => { settings.monitorInterval = +q('#st-mon-int').value; save() })
  q('#ct-new').addEventListener('click', () => openThemeEditor())
  const kg = q('#st-keygen')
  if (kg) kg.addEventListener('click', () => keygenDialog())
  const ik = q('#st-installkey')
  if (ik) ik.addEventListener('click', () => installKeyOnServer())
  renderCustomThemesList()
}

const __v9BuildPane = buildSettingsPane
buildSettingsPane = function (paneEl) {
  __v9BuildPane(paneEl)
  injectV9Settings(paneEl)
}

// === quake: перерегистрация хоткея при смене настроек ===
function quakeSettings() {
  return {
    quakeEnabled: settings.quakeEnabled === true,
    quakeHotkey: settings.quakeHotkey || 'CommandOrControl+`',
    quakeDock: settings.quakeDock !== false,
    quakeHeight: settings.quakeHeight || 50,
  }
}
const __v9ApplyAll = applyAllSettings
applyAllSettings = function () {
  __v9ApplyAll()
  try { window.api.quakeRefresh(quakeSettings()) } catch {}
}

// === палитра: новые команды ===
const __v9Palette = paletteItems
paletteItems = function () {
  const items = __v9Palette()
  items.push({ label: 'Broadcast-ввод вкл/выкл', hint: 'Ctrl+Shift+B', run: () => toggleBroadcast() })
  const t = tabs.get(activeId)
  if (t && t.type === 'ssh') {
    items.push({ label: 'SSH-туннели…', run: () => openTunnels() })
    items.push({ label: 'Мониторинг сервера вкл/выкл', run: () => toggleMonitor() })
    items.push({ label: 'Установить SSH-ключ на этот сервер…', run: () => installKeyOnServer() })
  }
  items.push({ label: 'Создать SSH-ключ…', run: () => keygenDialog() })
  items.push({ label: 'Новая тема оформления…', run: () => openThemeEditor() })
  return items
}

// === восстановление вкладок + автотуннели ===
let __snapshotReady = false
let __restoring = false

function snapshotTabs() {
  if (!__snapshotReady || __restoring) return
  const list = []
  for (const t of tabs.values()) {
    if (t.type === 'ssh') list.push({ type: 'ssh', connId: (t.sshCfg && t.sshCfg.id) || null })
    else if (t.type !== 'settings') list.push({ type: 'local' })
  }
  settings.lastTabs = list
  void saveSettingsChecked()
}

const __v9AddTab = addTab
addTab = function (id, title, type, sshCfg) {
  const tb = __v9AddTab(id, title, type, sshCfg)
  try { snapshotTabs() } catch {}
  if (type === 'ssh' && sshCfg) {
    const conn = sshCfg.id ? connections.find((c) => c.id === sshCfg.id) : null
    const tuns = (conn && conn.tunnels) || sshCfg.tunnels || []
    for (const t of tuns) {
      if (t.auto) startTunnel(id, t, true)
    }
  }
  return tb
}

const __v9CloseTab = closeTab
closeTab = function (id, killSession) {
  try { window.api.monitorStop(id) } catch {}
  for (const k of [...runningTunnels]) {
    if (k.indexOf(id + ':') === 0) runningTunnels.delete(k)
  }
  __v9CloseTab(id, killSession)
  try { snapshotTabs() } catch {}
}

// === старт: темы, quake, восстановление ===
function showOnboarding() {
  return new Promise((resolve) => {
    let action = null
    const d = makeDialog('<h2>Первый запуск</h2><p>Выбери, с чего начать</p><div class="onboarding-actions"><button class="btn primary" data-action="local">Открыть локальный терминал</button><button class="btn" data-action="ssh">Добавить SSH-сервер</button><button class="btn" data-action="tabby">Импортировать из Tabby</button></div><div class="modal-actions"><button class="btn ghost" data-action="later">Не сейчас</button></div>')
    d.onClose(() => resolve(action))
    d.m.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
      settings.onboardingComplete = true
      if (!await saveSettingsChecked()) return
      action = button.dataset.action
      d.close()
    }))
  })
}

async function runCiSmoke() {
  const created = await window.api.createLocal({ shell: '', cols: 80, rows: 24 })
  if (!created || created.error) throw new Error(created && created.error || 'локальный PTY не создан')
  addTab(created.id, created.title || 'smoke', 'local')
  const nonce = 'MEOWSHELL_SMOKE_' + Math.random().toString(36).slice(2)
  const output = new Promise((resolve, reject) => {
    let received = ''
    const timer = setTimeout(() => {
      smokeDataWaiters.delete(created.id)
      reject(new Error('PTY не вернул контрольную строку за 10 секунд'))
    }, 10000)
    smokeDataWaiters.set(created.id, (data) => {
      received = (received + String(data)).slice(-65536)
      if (!received.includes(nonce)) return
      clearTimeout(timer)
      smokeDataWaiters.delete(created.id)
      resolve()
    })
  })
  window.api.resize(created.id, 91, 27)
  window.api.write(created.id, 'echo ' + nonce + (rendererPlatform === 'win32' ? '\r' : '\n'))
  await output
  closeTab(created.id, true)
}

const startupPromise = (async () => {
  await initPromise
  if (rendererSmokeTest) {
    await runCiSmoke()
    window.api.smokeReady({ ok: true })
    return
  }
  mergeCustomThemes()
  if (THEMES[settings.theme] && THEMES[settings.theme].custom) applyAllSettings()
  try { window.api.quakeRefresh(quakeSettings()) } catch {}
  const onboardingAction = settings.onboardingComplete === true ? null : await showOnboarding()
  if (onboardingAction === 'local') await newLocalTab()
  else if (onboardingAction === 'ssh') openSshModal()
  else if (onboardingAction === 'tabby') {
    const imported = await window.api.importTabby()
    if (imported && imported.view) {
      connections = imported.view.connections || connections
      renderConnections()
      toast(imported.added ? 'Импортировано серверов: ' + imported.added : 'Новых серверов не найдено')
    } else if (imported && imported.error) toast('Импорт: ' + imported.error, true)
  }
  const list = (settings.lastTabs || []).slice()
  if (!onboardingAction && settings.restoreTabs === true && list.length) {
    __restoring = true
    for (const it of list) {
      try {
        if (it.type === 'local') {
          await newLocalTab()
        } else if (it.type === 'ssh' && it.connId) {
          const conn = connections.find((c) => c.id === it.connId)
          if (conn && (conn.hasPassword || conn.keyPath)) await connectSaved(conn)
        }
      } catch {}
    }
    __restoring = false
  }
  if (onboardingAction !== 'ssh' && ![...tabs.values()].some((tab) => tab.type === 'local' || tab.type === 'ssh')) await newLocalTab()
  __snapshotReady = true
  snapshotTabs()
})()
startupPromise.catch((err) => {
  toast('Ошибка запуска: ' + (err && err.message ? err.message : err), true)
  if (rendererSmokeTest) window.api.smokeReady({ ok: false, error: err && err.message ? err.message : String(err) })
})

// ==================== v1.0: библиотека команд, свои шрифты ====================

// ---------- библиотека готовых команд ----------
var PRESET_SNIPPETS = [
  { name: 'Обновить сервер', cmd: 'sudo apt update && sudo apt upgrade -y', enter: false },
  { name: 'Свободное место', cmd: 'df -h', enter: true },
  { name: 'Размер папок', cmd: 'du -h --max-depth=1 . 2>/dev/null | sort -hr | head -20', enter: true },
  { name: 'Кто ест CPU', cmd: 'ps aux --sort=-%cpu | head -15', enter: true },
  { name: 'Кто ест память', cmd: 'ps aux --sort=-%mem | head -15', enter: true },
  { name: 'Память подробно', cmd: 'free -h', enter: true },
  { name: 'Открытые порты', cmd: 'ss -tulpn', enter: true },
  { name: 'Активные сервисы', cmd: 'systemctl list-units --type=service --state=running', enter: true },
  { name: 'Перезапуск сервиса', cmd: 'sudo systemctl restart ', enter: false },
  { name: 'Логи сервиса', cmd: 'journalctl -u nginx -f -n 100', enter: false },
  { name: 'Логи nginx (ошибки)', cmd: 'tail -f /var/log/nginx/error.log', enter: false },
  { name: 'Публичный IP', cmd: 'curl -s ifconfig.me && echo', enter: true },
  { name: 'Аптайм и нагрузка', cmd: 'uptime', enter: true },
  { name: 'Бэкап папки', cmd: 'tar -czf backup-$(date +%F).tar.gz ', enter: false },
  { name: 'Docker: контейнеры', cmd: 'docker ps -a', enter: true },
  { name: 'Docker: логи', cmd: 'docker logs -f --tail 100 ', enter: false },
]

function openSnippetLibrary() {
  var d = makeDialog('<h2><i class=ic-book></i> Библиотека команд</h2>' +
    '<div class="set-hint">Готовые команды для Linux-серверов. Добавленные появятся на панели быстрых команд. Команды с пробелом на конце ждут, пока ты допишешь имя сервиса/папки.</div>' +
    '<div id="lib-list"></div>' +
    '<div class="modal-actions"><button class="btn ghost" id="lib-close">Закрыть</button><button class="btn primary" id="lib-all">Добавить все</button></div>')
  d.m.classList.add('modal-wide')
  var listEl = d.m.querySelector('#lib-list')
  function has(p) { return (settings.snippets || []).some(function (s) { return s.cmd === p.cmd }) }
  function add(p) {
    settings.snippets = settings.snippets || []
    settings.snippets.push({ name: p.name, cmd: p.cmd, enter: !!p.enter })
  }
  function render() {
    listEl.innerHTML = ''
    PRESET_SNIPPETS.forEach(function (p) {
      var row = document.createElement('div')
      row.className = 'lib-row'
      row.innerHTML = '<div class="lib-info"><b></b><code></code></div><button class="btn small" title="Добавить"></button>'
      row.querySelector('b').textContent = p.name
      row.querySelector('code').textContent = p.cmd
      var btn = row.querySelector('button')
      if (has(p)) {
        btn.innerHTML = '<i class=ic-check></i>'
        btn.disabled = true
      } else {
        btn.innerHTML = '<i class=ic-plus></i>'
        btn.addEventListener('click', async function () {
          add(p)
          if (!await saveSettingsChecked()) return
          renderSnippets()
          render()
        })
      }
      listEl.appendChild(row)
    })
  }
  render()
  d.m.querySelector('#lib-close').addEventListener('click', d.close)
  d.m.querySelector('#lib-all').addEventListener('click', async function () {
    PRESET_SNIPPETS.forEach(function (p) { if (!has(p)) add(p) })
    if (!await saveSettingsChecked()) return
    renderSnippets()
    render()
    toast('Все команды добавлены на панель')
  })
}
try { document.getElementById('btn-snippet-lib').addEventListener('click', openSnippetLibrary) } catch {}

// ---------- свои шрифты из папки fonts/ ----------
var customFonts = []
async function loadCustomFonts() {
  try {
    var list = await window.api.fontsList()
    for (var i = 0; i < list.length; i++) {
      var f = list[i]
      try {
        var face = new FontFace(f.name, 'url("' + f.url + '")')
        await face.load()
        document.fonts.add(face)
        customFonts.push(f.name)
      } catch (e) { console.warn('Шрифт не загрузился:', f.name, e) }
    }
  } catch {}
}
function applyUiFont() {
  document.body.style.fontFamily = settings.uiFont
    ? '"' + settings.uiFont + '", "Segoe UI Variable Text", "Segoe UI", sans-serif'
    : ''
}
var __v10ApplyAll = applyAllSettings
applyAllSettings = function () {
  __v10ApplyAll()
  applyUiFont()
}

function injectV10Settings(pane) {
  if (pane.querySelector('#st-uifont')) return
  var app = pane.querySelector('.set-section[data-cat="appearance"]')
  if (!app) return
  var uiOpts = '<option value="">Segoe UI (системный)</option>'
  customFonts.forEach(function (n) { uiOpts += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>' })
  var termOpts = '<option value="">— не менять —</option>'
  customFonts.concat(['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas']).forEach(function (n) {
    termOpts += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'
  })
  app.insertAdjacentHTML('beforeend',
    '<div class="set-card"><b><i class=ic-type></i> Шрифты</b>' +
    '<div class="set-row"><label>Шрифт интерфейса</label><select id="st-uifont">' + uiOpts + '</select></div>' +
    '<div class="set-row"><label>Шрифт терминала</label><select id="st-termfont">' + termOpts + '</select></div>' +
    '<div class="set-hint">Свои шрифты: положи файлы .ttf / .woff2 в папку fonts рядом с приложением и перезапусти MeowShell — они появятся в списках сами (устанавливать в Windows не нужно). Подробности и ссылки — в fonts/README.txt.</div></div>')
  var u = pane.querySelector('#st-uifont')
  u.value = settings.uiFont || ''
  u.addEventListener('change', function () {
    settings.uiFont = u.value || ''
    void saveSettingsChecked()
    applyAllSettings()
  })
  var tsel = pane.querySelector('#st-termfont')
  tsel.addEventListener('change', function () {
    if (!tsel.value) return
    settings.fontFamily = '"' + tsel.value + '", Consolas, "Courier New", monospace'
    var inp = pane.querySelector('#st-fontfamily')
    if (inp) inp.value = settings.fontFamily
    void saveSettingsChecked()
    applyAllSettings()
    toast('Шрифт терминала: ' + tsel.value)
  })
}
var __v10BuildPane = buildSettingsPane
buildSettingsPane = function (pane) {
  __v10BuildPane(pane)
  injectV10Settings(pane)
}

var __v10Palette = paletteItems
paletteItems = function () {
  var items = __v10Palette()
  items.push({ label: 'Библиотека готовых команд…', run: function () { openSnippetLibrary() } })
  return items
}

;(function () {
  setTimeout(async function () {
    await loadCustomFonts()
    applyUiFont()
  }, 200)
})()

// ==================== v1.1: ripple, слайдеры, предпросмотр шрифтов ====================
;(function () {
  // Ripple-эффект (волна от клика) на кнопках и пунктах меню
  document.addEventListener('mousedown', function (e) {
    if (!e.target || !e.target.closest) return
    var b = e.target.closest('.btn, .set-nav-item, .ctx-item, .palette-item, .conn-item')
    if (!b) return
    var r = b.getBoundingClientRect()
    var d = Math.max(r.width, r.height) * 2
    var s = document.createElement('span')
    s.className = 'v11-ripple'
    s.style.width = d + 'px'
    s.style.height = d + 'px'
    s.style.left = (e.clientX - r.left - d / 2) + 'px'
    s.style.top = (e.clientY - r.top - d / 2) + 'px'
    b.appendChild(s)
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s) }, 650)
  }, true)

  // Заливка ползунков акцентным цветом до бегунка
  function rangeFill(el) {
    var min = parseFloat(el.min); if (isNaN(min)) min = 0
    var max = parseFloat(el.max); if (isNaN(max)) max = 100
    var v = parseFloat(el.value); if (isNaN(v)) v = min
    var p = max > min ? ((v - min) / (max - min)) * 100 : 0
    el.style.background = 'linear-gradient(90deg, var(--accent) ' + p + '%, var(--bg3) ' + p + '%)'
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.type === 'range') rangeFill(e.target)
  }, true)
  function scanRanges() {
    var list = document.querySelectorAll('input[type=range]')
    for (var i = 0; i < list.length; i++) {
      if (!list[i].__v11r) { list[i].__v11r = 1; rangeFill(list[i]) }
    }
  }
  new MutationObserver(scanRanges).observe(document.body, { childList: true, subtree: true })
  scanRanges()
})()

// Предпросмотр каждого шрифта под выпадающим списком
function v11FontPreview(pane) {
  if (pane.querySelector('.font-preview')) return
  var uiSel = pane.querySelector('#st-uifont')
  var tSel = pane.querySelector('#st-termfont')
  if (!uiSel || !tSel) return
  function mk(sel, fonts, sample, mono) {
    var box = document.createElement('div')
    box.className = 'font-preview'
    function mark() {
      for (var i = 0; i < box.children.length; i++) {
        var r = box.children[i]
        r.classList.toggle('sel', r.getAttribute('data-f') === sel.value)
      }
    }
    if (!fonts.length) {
      var em = document.createElement('div')
      em.className = 'fp-empty'
      em.textContent = 'Положи файлы шрифтов (.ttf / .woff2) в папку fonts рядом с приложением и перезапусти MeowShell — здесь появится предпросмотр.'
      box.appendChild(em)
    }
    fonts.forEach(function (name) {
      var row = document.createElement('div')
      row.className = 'fp-row'
      row.setAttribute('data-f', name)
      var nm = document.createElement('div')
      nm.className = 'fp-name'
      nm.textContent = name
      var sm = document.createElement('div')
      sm.className = 'fp-sample'
      sm.textContent = sample
      sm.style.fontFamily = '"' + name + '", ' + (mono ? 'monospace' : 'sans-serif')
      row.appendChild(nm)
      row.appendChild(sm)
      row.addEventListener('click', function () {
        sel.value = name
        sel.dispatchEvent(new Event('change'))
      })
      box.appendChild(row)
    })
    sel.addEventListener('change', mark)
    var host = sel.closest('.set-row')
    if (host) host.insertAdjacentElement('afterend', box)
    mark()
  }
  mk(uiSel, customFonts.slice(), 'Съешь ещё этих мягких французских булок, да выпей чаю. 0123456789', false)
  mk(tSel, customFonts.concat(['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas']), 'user@server:~$ tail -f app.log | grep err -> 0O 1lI {} != ===', true)
}
var __v11BuildPane = buildSettingsPane
buildSettingsPane = function (pane) {
  __v11BuildPane(pane)
  try { v11FontPreview(pane) } catch (e) {}
}

// ==================== v1.1.2: гарантированная подгонка размера консоли ====================
;(function () {
  var rt = null
  function refitActive() {
    var tab = tabs.get(activeId)
    if (tab) fitTab(tab)
    clearTimeout(rt)
    rt = setTimeout(function () {
      var t2 = tabs.get(activeId)
      if (t2) fitTab(t2)
    }, 160)
  }
  window.addEventListener('resize', refitActive)
  // Сторож: если размер терминала разошёлся с окном — подгоняем автоматически
  setInterval(function () {
    var tab = tabs.get(activeId)
    if (!tab || !tab.fit || !tab.paneEl || tab.paneEl.classList.contains('hidden')) return
    try {
      var d = tab.fit.proposeDimensions()
      if (d && d.cols > 1 && d.rows > 1 && (d.cols !== tab.term.cols || d.rows !== tab.term.rows)) fitTab(tab)
    } catch (e) {}
  }, 1500)
})()

// ==================== v2.0: кнопки собственной шапки окна ====================
;(function () {
  var mn = document.getElementById('tb-min')
  var mx = document.getElementById('tb-max')
  var cl = document.getElementById('tb-close')
  if (mn) mn.addEventListener('click', function () { window.api.winMinimize() })
  if (mx) mx.addEventListener('click', function () { window.api.winMaximizeToggle() })
  if (cl) cl.addEventListener('click', function () { window.api.winClose() })
  if (window.api.onWinMaxState) window.api.onWinMaxState(function (isMax) {
    if (mx) mx.innerHTML = isMax
      ? '<svg viewBox="0 0 10 10"><rect x="1" y="3" width="6" height="6" rx="1"/><path d="M3.5 3V1.5h5.5v5.5H7"/></svg>'
      : '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>'
    document.body.classList.toggle('is-max', isMax)
  })
})()

// ===== v2.0.1: фиксы размера терминала + захват хоткея =====
;(function () {
  // При переключении вкладки всегда подгоняем размер (важно для восстановленных SSH-вкладок,
  // которые создавались скрытыми с размером 80x24 и никогда не подгонялись)
  var __v201Activate = activateTab
  activateTab = function (id) {
    __v201Activate(id)
    var t = tabs.get(activeId)
    if (t && t.fit) {
      requestAnimationFrame(function () { try { fitTab(t) } catch (e) {} })
      setTimeout(function () { try { fitTab(t) } catch (e) {} }, 120)
    }
  }

  // Сторож: если локальный размер изменился — досылаем его на PTY/SSH-сервер
  // (раньше удалённая сторона могла остаться на старом размере и рисовать в углу)
  setInterval(function () {
    var tab = tabs.get(activeId)
    if (!tab || !tab.term || !tab.paneEl || tab.paneEl.classList.contains('hidden')) return
    var k = tab.id + ':' + tab.term.cols + 'x' + tab.term.rows
    if (tab.__v201Sync !== k) {
      try { window.api.resize(tab.id, tab.term.cols, tab.term.rows) } catch (e) {}
      tab.__v201Sync = k
    }
    if (tab.split && tab.split.term) {
      var k2 = tab.split.id + ':' + tab.split.term.cols + 'x' + tab.split.term.rows
      if (tab.__v201SyncSplit !== k2) {
        try { window.api.resize(tab.split.id, tab.split.term.cols, tab.split.term.rows) } catch (e) {}
        tab.__v201SyncSplit = k2
      }
    }
  }, 1600)

  // --- захват хоткея: клик по полю — и жмёшь любое сочетание ---
  function v201AccFromEvent(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null
    var mods = []
    if (e.ctrlKey) mods.push('Control')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    var k = null
    var c = e.code || ''
    if (/^Key[A-Z]$/.test(c)) k = c.slice(3)
    else if (/^Digit[0-9]$/.test(c)) k = c.slice(5)
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) k = c
    else if (c === 'Backquote') k = '`'
    else if (c === 'Space') k = 'Space'
    else if (e.key === 'Escape' || e.key === 'Tab' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Insert' || e.key === 'Delete') k = e.key
    else if (e.key && e.key.length === 1) k = e.key.toUpperCase()
    if (!k) return null
    if (!mods.length && !/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return null // без модификатора — только F-клавиши
    mods.push(k)
    return mods.join('+')
  }
  function v201HotkeyLabel(acc) {
    return String(acc || '').replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl').split('+').join(' + ')
  }
  function v201UpgradePane(pane) {
    var sel = pane.querySelector('#st-quake-key')
    if (sel && sel.tagName === 'SELECT') {
      var inp = document.createElement('input')
      inp.type = 'text'
      inp.id = 'st-quake-key'
      inp.readOnly = true
      inp.className = 'hotkey-cap'
      inp.title = 'Кликни и нажми новое сочетание клавиш'
      inp.value = v201HotkeyLabel(settings.quakeHotkey || 'CommandOrControl+`')
      sel.parentNode.replaceChild(inp, sel)
      inp.addEventListener('focus', function () {
        inp.value = 'Нажми сочетание… (Esc — отмена)'
        inp.classList.add('rec')
      })
      inp.addEventListener('blur', function () {
        inp.value = v201HotkeyLabel(settings.quakeHotkey || 'CommandOrControl+`')
        inp.classList.remove('rec')
      })
      inp.addEventListener('keydown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') { inp.blur(); return }
        var acc = v201AccFromEvent(e)
        if (!acc) return
        settings.quakeHotkey = acc
        void saveSettingsChecked()
        try { applyAllSettings() } catch (er) {}
        inp.blur()
        toast('Хоткей quake-режима: ' + v201HotkeyLabel(acc))
      })
    }
    var hk = pane.querySelector('.hk-table')
    if (hk && !pane.querySelector('#v201-hk-hint')) {
      var card = hk.closest('.set-card')
      if (card) card.insertAdjacentHTML('beforeend', '<div class="set-hint" id="v201-hk-hint">Эти сочетания пока фиксированные. Глобальный хоткей quake-режима меняется на вкладке «Фичи» — кликни по полю и нажми любое сочетание.</div>')
    }
  }
  var __v201BuildPane = buildSettingsPane
  buildSettingsPane = function (paneEl) {
    __v201BuildPane(paneEl)
    try { v201UpgradePane(paneEl) } catch (e) {}
  }
})()
