'use strict'

;(function () {
  const en = {
    'Светлая': 'Light',
    'Скрыть/показать панель': 'Show/hide sidebar',
    'Свернуть': 'Minimize',
    'Развернуть': 'Maximize',
    'Закрыть': 'Close',
    'Локальный терминал': 'Local terminal',
    'SSH подключение': 'SSH connection',
    'Сохранённые серверы': 'Saved servers',
    'Настройки': 'Settings',
    'Добавить быструю команду': 'Add quick command',
    'команда': 'command',
    'Библиотека готовых команд': 'Command library',
    'Библиотека': 'Library',
    '— новый терминал ·': '— new terminal ·',
    '— переключение вкладок': '— switch tabs',
    '— поиск ·': '— search ·',
    '— вставка скриншота/файла как пути': '— paste a screenshot/file as a path',
    'Поиск… (Enter — далее)': 'Search… (Enter — next)',
    'Назад': 'Previous',
    'Далее': 'Next',
    'Вверх': 'Up',
    'Перейти': 'Go',
    'Загрузить сюда': 'Upload here',
    'Новая папка': 'New folder',
    'имя папки — Enter': 'folder name — Enter',
    'Название (для списка)': 'Name (shown in list)',
    'Мой VPS': 'My VPS',
    'Хост': 'Host',
    'example.com или 1.2.3.4': 'example.com or 1.2.3.4',
    'Порт': 'Port',
    'Пользователь': 'User',
    'Способ входа': 'Authentication',
    'Пароль': 'Password',
    'Приватный ключ': 'Private key',
    'Путь к ключу': 'Key path',
    'Обзор…': 'Browse…',
    'Пароль от ключа (если есть)': 'Key passphrase (if any)',
    'Сохранить в список': 'Save to list',
    'Сохранить пароль (шифруется)': 'Save password (encrypted)',
    'Отмена': 'Cancel',
    'Подключиться': 'Connect',
    'Быстрая команда': 'Quick command',
    'Название кнопки': 'Button name',
    'Логи nginx': 'nginx logs',
    'Команда': 'Command',
    'Нажимать Enter после вставки': 'Press Enter after inserting',
    'Добавить': 'Add',
    'Пока пусто': 'Nothing here yet',
    'Удалить': 'Delete',
    'Подключено': 'Connected',
    'Загрузка…': 'Loading…',
    'Пустая папка': 'Empty folder',
    'Скачать папку': 'Download folder',
    'Скачать': 'Download',
    'Сохранить': 'Save',
    'Подтверждение': 'Confirmation',
    'Да': 'Yes',
    'Открыть': 'Open',
    'Редактировать': 'Edit',
    'Переименовать': 'Rename',
    'Права (chmod)': 'Permissions (chmod)',
    'Что сделать? Начни печатать…': 'What do you want to do? Start typing…',
    'Внешний вид': 'Appearance',
    'Фон': 'Background',
    'Терминал': 'Terminal',
    'Хоткеи': 'Shortcuts',
    'Прочее': 'General',
    'Все изменения применяются и сохраняются сразу': 'All changes are applied and saved immediately',
    'Поиск настроек…': 'Search settings…',
    'Тема': 'Theme',
    'Эффект ввода текста': 'Typing effect',
    'Свечение курсора': 'Cursor glow',
    'Искры': 'Sparks',
    'Выключен': 'Off',
    'Размер шрифта': 'Font size',
    'Насыщенность шрифта': 'Font weight',
    'Обычная': 'Normal',
    'Средняя': 'Medium',
    'Полужирная': 'Semi-bold',
    'Жирная': 'Bold',
    'Межстрочный интервал': 'Line height',
    'Межбуквенный интервал': 'Letter spacing',
    'Шрифт терминала (по приоритету)': 'Terminal font (in priority order)',
    'Шрифт должен быть установлен в Windows. Cascadia Code и JetBrains Mono — бесплатные и выглядят лучше всего.': 'The font must be installed in Windows. Cascadia Code and JetBrains Mono are free and work especially well.',
    'Фоновое изображение': 'Background image',
    'Картинка': 'Image',
    'Выбрать…': 'Choose…',
    'Убрать': 'Remove',
    'Затемнение': 'Dim',
    'Размытие': 'Blur',
    'Шелл по умолчанию': 'Default shell',
    'Другой…': 'Other…',
    'Путь к шеллу': 'Shell path',
    'например wsl.exe': 'for example wsl.exe',
    'Применяется к новым вкладкам': 'Applies to new tabs',
    'Стиль курсора': 'Cursor style',
    'Блок': 'Block',
    'Палочка': 'Bar',
    'Подчёркивание': 'Underline',
    'Мигание курсора': 'Blinking cursor',
    'Плавный курсор-«призрак»': 'Smooth ghost cursor',
    'История прокрутки (строк)': 'Scrollback history (lines)',
    'Скорость прокрутки колёсиком': 'Mouse-wheel scroll speed',
    'Колёсико в программах (vim, Claude Code)': 'Mouse wheel in programs (vim, Claude Code)',
    'По одной стрелке (плавно)': 'One arrow at a time (smooth)',
    'Как раньше (пачкой)': 'Legacy batch mode',
    'Не листать': 'Disabled',
    'Копировать при выделении': 'Copy on select',
    'Вставка правой кнопкой мыши': 'Right-click paste',
    'Ctrl+C копирует выделение': 'Ctrl+C copies selection',
    'Если ничего не выделено — Ctrl+C, как обычно, отправит прерывание в терминал. Ctrl+Shift+C копирует всегда.': 'With no selection, Ctrl+C sends an interrupt as usual. Ctrl+Shift+C always copies.',
    'Убирать Enter в конце вставки': 'Remove trailing Enter when pasting',
    'Вставлять много строк одним блоком': 'Paste multiple lines as one block',
    'GPU-ускорение (WebGL)': 'GPU acceleration (WebGL)',
    'WebGL применяется к новым вкладкам': 'WebGL applies to new tabs',
    'Автопереподключение при обрыве': 'Reconnect automatically after disconnect',
    'Горячие клавиши': 'Keyboard shortcuts',
    'Новый терминал': 'New terminal',
    'Закрыть вкладку': 'Close tab',
    'Следующая вкладка': 'Next tab',
    'Сплит вертикальный': 'Vertical split',
    'Сплит горизонтальный': 'Horizontal split',
    'Командная палитра': 'Command palette',
    'Поиск по терминалу': 'Search terminal',
    'Вставить текст / скриншот / файл': 'Paste text / screenshot / file',
    'Закрыть панели и меню': 'Close panels and menus',
    'Язык интерфейса': 'Interface language',
    'Авто (системный)': 'Auto (system)',
    'Английский': 'English',
    'Русский': 'Russian',
    'Импорт серверов из Tabby': 'Import servers from Tabby',
    'Импортировать…': 'Import…',
    'Данные и диагностика': 'Data & diagnostics',
    'Экспорт без паролей и ключевых фраз': 'Export without passwords or passphrases',
    'Экспортировать…': 'Export…',
    'Импорт конфигурации': 'Import configuration',
    'Открыть логи': 'Open logs',
    'Открыть дампы': 'Open crash dumps',
    'Открыть резервные копии': 'Open backups',
    'Сбросить настройки интерфейса': 'Reset interface settings',
    'Сбросить все данные': 'Reset all data',
    'Безопасный режим GPU': 'GPU safe mode',
    'Отключить безопасный режим и перезапустить': 'Disable safe mode and restart',
    'Телеметрия отсутствует. Диагностика хранится только локально.': 'No telemetry. Diagnostics stay on this device.',
    'Экспериментальные': 'Experimental',
    'Экспериментальные функции': 'Experimental features',
    'WebGL может повысить производительность, но на некоторых драйверах вызывает сбои. Безопасный режим отключает его автоматически.': 'WebGL may improve performance, but can crash with some drivers. Safe mode disables it automatically.',
    'Фичи': 'Features',
    'Мои темы': 'My themes',
    'Quake-режим': 'Quake mode',
    'Включён': 'Enabled',
    'Глобальный хоткей': 'Global shortcut',
    'Прилипать к верху экрана': 'Dock to top of screen',
    'Высота окна': 'Window height',
    'Вкладки': 'Tabs',
    'Восстанавливать вкладки при запуске': 'Restore tabs on startup',
    'Broadcast-ввод': 'Broadcast input',
    'Куда отправлять ввод': 'Input destination',
    'Во все сплиты текущей вкладки': 'All splits in current tab',
    'Во все вкладки сразу': 'All tabs',
    'Вставка': 'Paste',
    'Предупреждать при вставке нескольких строк': 'Warn before pasting multiple lines',
    'Мониторинг сервера': 'Server monitoring',
    'Интервал обновления': 'Refresh interval',
    'Создать на основе текущей': 'Create from current theme',
    'SSH-ключи': 'SSH keys',
    'Создать ключ…': 'Create key…',
    'Установить ключ на сервер активной вкладки…': 'Install key on active tab server…',
    'Фон не выбран': 'No background selected',
    'Системный язык': 'System language',
    'Первый запуск': 'Welcome',
    'Выбери, с чего начать': 'Choose how to get started',
    'Открыть локальный терминал': 'Open a local terminal',
    'Добавить SSH-сервер': 'Add an SSH server',
    'Импортировать из Tabby': 'Import from Tabby',
    'Не сейчас': 'Not now',
    'Скопировано': 'Copied',
    'Сплит закрыт': 'Split closed',
    'Для сплита SSH-вкладки переподключись к серверу': 'Reconnect the SSH tab before splitting it',
    'Открываю вторую SSH-сессию…': 'Opening a second SSH session…',
    'Экран разделён — тяни полоску между панелями, чтобы менять размер. Повторный клик закроет сплит': 'Screen split. Drag the divider to resize; click split again to close it.',
    'Укажи хост и пользователя': 'Enter a host and user',
    'Укажи путь к приватному ключу': 'Choose a private-key path',
    'Пароль не был сохранён. Введи его — с галочкой «Сохранить пароль» вход будет в один клик': 'The password was not saved. Enter it and enable “Save password” for one-click login.',
    'Команда удалена': 'Command removed',
    'Нет активной вкладки': 'No active tab',
    'Заполни название и команду': 'Enter a name and command',
    'Команда добавлена': 'Command added',
    'Папка создана': 'Folder created',
    'Команда скопирована': 'Command copied',
    'Сервер удалён': 'Server removed',
    'Сервер сохранён': 'Server saved',
    'Переименовано': 'Renamed',
    'Нужен формат вида 755': 'Use a mode such as 755',
    'Выбранный файл не является поддерживаемым изображением': 'The selected file is not a supported image',
    'Новых серверов не найдено': 'No new servers found',
    'Broadcast выключен': 'Broadcast disabled',
    'Мониторинг работает на SSH-вкладках': 'Monitoring works in SSH tabs',
    'Туннели работают через активную SSH-вкладку': 'Tunnels use the active SSH tab',
    'Укажи оба порта': 'Enter both ports',
    'Открой SSH-вкладку нужного сервера': 'Open an SSH tab for the target server',
    'Выбери публичный ключ (файл .pub)': 'Choose a public key (.pub file)',
    'Ключ добавлен в authorized_keys — теперь можно входить по ключу': 'Key added to authorized_keys; key-based login is now available',
    'Все команды добавлены на панель': 'All commands were added to the toolbar',
    'Соединение': 'Connection',
    'Настроить сервер': 'Edit server',
    'Копировать IP': 'Copy IP',
    'Копировать user@host': 'Copy user@host',
    'Копировать команду ssh': 'Copy ssh command',
    'Удалить из списка': 'Remove from list',
    'Новый локальный терминал': 'New local terminal',
    'Новое SSH-подключение': 'New SSH connection',
    'Показать/скрыть боковую панель': 'Show/hide sidebar',
    'Закрыть текущую вкладку': 'Close current tab',
    'Одной строкой': 'As one line',
    'Вставить как есть': 'Paste as-is',
    'Применить': 'Apply',
    'Создать…': 'Create…',
    'Сохранить и применить': 'Save and apply',
    'Своих тем пока нет — создай первую ниже.': 'No custom themes yet. Create one below.',
    'Пока нет туннелей — добавь ниже.': 'No tunnels yet. Add one below.',
    'Авто': 'Auto',
    'Локальный порт': 'Local port',
    'Удалённый хост': 'Remote host',
    'Удалённый порт': 'Remote port',
    'Создать туннель': 'Create tunnel',
    'Включать автоматически': 'Start automatically',
    'Кликни и нажми новое сочетание клавиш': 'Click and press a new shortcut',
    'Нажми сочетание… (Esc — отмена)': 'Press a shortcut… (Esc to cancel)',
    'Подключение…': 'Connecting…',
    'или Ctrl+Shift+B. Пока включён — вокруг терминала красная рамка.': 'or Ctrl+Shift+B. A red border appears around the terminal while broadcast is enabled.',
    '2 сек': '2 sec',
    '3 сек': '3 sec',
    '5 сек': '5 sec',
    '10 сек': '10 sec',
    'До 5 попыток с нарастающей паузой. Индикатор на вкладке: зелёный — подключено, жёлтый — переподключение, красный — обрыв.': 'Up to five attempts with increasing delay. Tab indicator: green — connected, yellow — reconnecting, red — disconnected.',
    'Спасает от «после каждой строки нажимается Enter» (Claude Code и т.п.). Если после включения при вставке появляются лишние символы вроде [200~ — выключи этот пункт.': 'Prevents each pasted line from being executed separately. Disable this if the pasted text contains markers such as [200~.',
    'Каждый перевод строки может выполнить команду. Проверь содержимое:': 'Each line break may execute a command. Review the content:',
    'сбор данных…': 'collecting data…',
    'нет данных (не Linux?)': 'no data (not Linux?)',
    'SSH-туннели': 'SSH tunnels',
    'Локальный порт на этом ПК пробрасывается на адрес, видимый с сервера. Туннель живёт, пока открыта эта SSH-вкладка.': 'A local port on this PC is forwarded to an address visible from the server. The tunnel lives while this SSH tab is open.',
    'Лок. порт': 'Local port',
    'Порт сервера': 'Server port',
    'авто': 'auto',
    'Стоп': 'Stop',
    'Запустить': 'Start',
    'Новый SSH-ключ': 'New SSH key',
    'Тип': 'Type',
    'ed25519 (рекомендуется)': 'ed25519 (recommended)',
    'Комментарий': 'Comment',
    'Пароль ключа': 'Key passphrase',
    'можно оставить пустым': 'may be left empty',
    'Ключ создан': 'Key created',
    'Копировать публичный': 'Copy public key',
    'Готово': 'Done',
    'Фон окна': 'Window background',
    'Панели': 'Panels',
    'Элементы': 'Elements',
    'Рамки': 'Borders',
    'Текст': 'Text',
    'Тусклый текст': 'Muted text',
    'Акцент': 'Accent',
    'Фон терминала': 'Terminal background',
    'Курсор': 'Cursor',
    'Выделение': 'Selection',
    'Изменить тему': 'Edit theme',
    'Новая тема': 'New theme',
    'Название': 'Name',
    'Интерфейс': 'Interface',
    '16 цветов ANSI': '16 ANSI colors',
    'Моя тема': 'My theme',
    'Изменить': 'Edit',
    'активна': 'active',
    'Хоткей работает из любой программы: терминал выезжает сверху поверх окон, повторное нажатие прячет его.': 'The shortcut works from any program: the terminal drops down above other windows and the next press hides it.',
    'SSH-вкладки восстанавливаются только для серверов с сохранённым паролем или ключом.': 'SSH tabs are restored only for servers with a saved password or key.',
    'Вкл/выкл: кнопка': 'Toggle with the button',
    'Пока включён — вокруг терминала красная рамка.': 'A red border appears around the terminal while broadcast is enabled.',
    'Кнопка': 'Button',
    'на SSH-вкладке показывает CPU / RAM / диск / аптайм (для Linux-серверов).': 'in an SSH tab shows CPU / RAM / disk / uptime for Linux servers.',
    'Тема меняет и интерфейс, и цвета терминала. Созданные темы появляются в общем списке тем.': 'A theme changes both the interface and terminal colors. Custom themes appear in the main theme list.',
    'С ключом вход без пароля: приватный файл указываешь в форме подключения, публичный (.pub) — устанавливаешь на сервер.': 'For passwordless login, select the private file in the connection form and install the public (.pub) key on the server.',
    'Broadcast-ввод вкл/выкл': 'Toggle broadcast input',
    'SSH-туннели…': 'SSH tunnels…',
    'Мониторинг сервера вкл/выкл': 'Toggle server monitoring',
    'Установить SSH-ключ на этот сервер…': 'Install an SSH key on this server…',
    'Создать SSH-ключ…': 'Create an SSH key…',
    'Новая тема оформления…': 'New color theme…',
    'Обновить сервер': 'Update server',
    'Свободное место': 'Free disk space',
    'Размер папок': 'Directory sizes',
    'Кто ест CPU': 'Top CPU processes',
    'Кто ест память': 'Top memory processes',
    'Память подробно': 'Memory details',
    'Открытые порты': 'Open ports',
    'Активные сервисы': 'Active services',
    'Перезапуск сервиса': 'Restart service',
    'Логи сервиса': 'Service logs',
    'Логи nginx (ошибки)': 'nginx error log',
    'Публичный IP': 'Public IP',
    'Аптайм и нагрузка': 'Uptime and load',
    'Бэкап папки': 'Back up directory',
    'Docker: контейнеры': 'Docker: containers',
    'Библиотека команд': 'Command library',
    'Готовые команды для Linux-серверов. Добавленные появятся на панели быстрых команд. Команды с пробелом на конце ждут, пока ты допишешь имя сервиса/папки.': 'Ready-to-use commands for Linux servers. Added commands appear on the quick-command toolbar. Commands ending with a space wait for a service or directory name.',
    'Добавить все': 'Add all',
    'Шрифты': 'Fonts',
    'Шрифт интерфейса': 'Interface font',
    'Шрифт терминала': 'Terminal font',
    'Segoe UI (системный)': 'Segoe UI (system)',
    '— не менять —': '— keep current —',
    'Свои шрифты: положи файлы .ttf / .woff2 в папку fonts рядом с приложением и перезапусти MeowShell — они появятся в списках сами (устанавливать в Windows не нужно). Подробности и ссылки — в fonts/README.txt.': 'Custom fonts: place .ttf / .woff2 files in the fonts directory next to the application and restart MeowShell. No system-wide installation is required. See fonts/README.txt.',
    'Положи файлы шрифтов (.ttf / .woff2) в папку fonts рядом с приложением и перезапусти MeowShell — здесь появится предпросмотр.': 'Place .ttf / .woff2 font files in the fonts directory next to the application and restart MeowShell to see a preview here.',
    'Съешь ещё этих мягких французских булок, да выпей чаю. 0123456789': 'The quick brown fox jumps over the lazy dog. 0123456789',
    'Эти сочетания пока фиксированные. Глобальный хоткей quake-режима меняется на вкладке «Фичи» — кликни по полю и нажми любое сочетание.': 'These shortcuts are currently fixed. Change the global quake-mode shortcut under Features by clicking the field and pressing a new shortcut.',
  }

  const phrases = [
    ['Безопасный режим: GPU-рендеринг отключён после прошлого сбоя', 'Safe mode: GPU rendering was disabled after the previous crash'],
    ['Не удалось загрузить конфигурацию', 'Could not load configuration'],
    ['Не удалось загрузить файл', 'Could not upload file'],
    ['Импортировано серверов', 'Servers imported'],
    ['Пароли Tabby не отдаёт — введи их при первом входе', 'Tabby does not export passwords; enter them on first login'],
    ['Скачивание папки', 'Downloading folder'],
    ['Папка скачана', 'Folder downloaded'],
    ['Скачивание', 'Downloading'],
    ['Загружено файлов', 'Files uploaded'],
    ['Загружаю', 'Uploading'],
    ['Ошибка загрузки', 'Upload error'],
    ['Файл готов, путь вставлен', 'File ready; path inserted'],
    ['IP скопирован', 'IP copied'],
    ['Права изменены', 'Permissions changed'],
    ['Удалено', 'Deleted'],
    ['Подключение к', 'Connecting to'],
    ['Подключиться:', 'Connect:'],
    ['Вкладка:', 'Tab:'],
    ['локальная', 'local'],
    ['Команда:', 'Command:'],
    ['Вставка ', 'Pasting '],
    [' строк', ' lines'],
    ['… ещё ', '… another '],
    ['во все вкладки', 'to all tabs'],
    ['во все сплиты вкладки', 'to all splits in the tab'],
    ['Broadcast ВКЛ: ввод идёт', 'Broadcast enabled: input goes'],
    ['Туннель:', 'Tunnel:'],
    ['Тема «', 'Theme “'],
    ['» применена', '” applied'],
    ['ярк.', 'bright '],
    ['Сигнал', 'Bell'],
    ['Шрифт терминала', 'Terminal font'],
    ['Шрифт', 'Font'],
    ['Хоткей quake-режима', 'Quake-mode shortcut'],
    ['Ключ', 'Key'],
    ['Не удалось', 'Failed'],
    ['Ошибка', 'Error'],
    ['Импорт', 'Import'],
    ['Сохранено', 'Saved'],
    ['Скопировано', 'Copied'],
    ['Загружено', 'Uploaded'],
  ]

  const originals = new WeakMap()
  const attributes = ['title', 'placeholder', 'aria-label']
  let current = 'en'
  let applying = false

  function resolved(language) {
    if (language === 'ru' || language === 'en') return language
    return /^ru(?:-|$)/i.test(navigator.language || '') ? 'ru' : 'en'
  }

  function exact(value) {
    if (current === 'ru') return value
    const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/)
    return match[1] + (en[match[2]] || phrase(match[2])) + match[3]
  }

  function phrase(value) {
    let result = String(value)
    for (const [source, target] of phrases) result = result.split(source).join(target)
    return result
  }

  function tr(value) {
    if (current === 'ru') return String(value)
    const direct = en[String(value)]
    if (direct) return direct
    return phrase(String(value))
      .replace(/^Ошибка:\s*/i, 'Error: ')
      .replace(/^Импорт:\s*/i, 'Import: ')
      .replace(/^Сохранено:\s*/i, 'Saved: ')
      .replace(/^Скопировано:\s*/i, 'Copied: ')
      .replace(/^Загружено:\s*/i, 'Uploaded: ')
      .replace(/^Подключение к\s+/, 'Connecting to ')
      .replace(/…$/, '…')
  }

  function applyText(node) {
    const parent = node.parentElement
    if (parent && parent.closest('.xterm, .conn-name, .conn-host, .tab-title, .sftp-name, code, pre, textarea')) return
    if (!originals.has(node)) originals.set(node, node.nodeValue)
    node.nodeValue = exact(originals.get(node))
  }

  function applyElement(element) {
    for (const name of attributes) {
      if (!element.hasAttribute(name)) continue
      const key = 'i18nOriginal' + name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      if (!(key in element.dataset)) element.dataset[key] = element.getAttribute(name)
      element.setAttribute(name, exact(element.dataset[key]))
    }
  }

  function apply(root) {
    applying = true
    try {
      if (root.nodeType === Node.TEXT_NODE) applyText(root)
      if (root.nodeType === Node.ELEMENT_NODE) applyElement(root)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) applyText(node)
        else applyElement(node)
      }
      document.documentElement.lang = current
    } finally {
      applying = false
    }
  }

  function setLanguage(language) {
    current = resolved(language)
    if (document.documentElement) apply(document.documentElement)
    return current
  }

  const observer = new MutationObserver((mutations) => {
    if (applying) return
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const previous = originals.get(mutation.target)
        if (previous !== undefined && mutation.target.nodeValue === exact(previous)) continue
        originals.set(mutation.target, mutation.target.nodeValue)
      }
      for (const node of mutation.addedNodes) apply(node)
      if (mutation.type === 'characterData') apply(mutation.target)
    }
  })

  current = resolved('auto')
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  })

  window.MeowI18n = { apply, language: () => current, setLanguage, tr }
})()
