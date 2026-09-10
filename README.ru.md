<p align="center">
  <img src="assets/logo.png" width="150" alt="Логотип MeowShell">
</p>

<h1 align="center">MeowShell</h1>

<p align="center">
  Приватный Windows-терминал для локальных shell, SSH, SFTP и спокойной удалённой работы.
</p>

<p align="center">
  <a href="https://github.com/kimi-1337/meowshell/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kimi-1337/meowshell/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/kimi-1337/meowshell/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/kimi-1337/meowshell/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="https://github.com/kimi-1337/meowshell/releases/tag/v2.3.0-beta.7"><img alt="Релиз 2.3.0 beta 7" src="https://img.shields.io/badge/release-2.3.0--beta.7-f59e0b"></a>
  <a href="LICENSE"><img alt="GPL-3.0-only" src="https://img.shields.io/badge/license-GPL--3.0--only-2ea44f"></a>
</p>

<p align="center">
  <a href="#скачать">Скачать</a> ·
  <a href="#возможности">Возможности</a> ·
  <a href="#разработка-и-сборка">Разработка</a> ·
  <a href="SECURITY.md">Безопасность</a> ·
  <a href="README.md">English</a>
</p>

> **Бета-версия.** Перед тестированием сохрани резервные копии важных данных.
> Текущая сборка не подписана и может вызвать предупреждение Microsoft Defender
> SmartScreen.

[English version](README.md)

## Скачать

### [Скачать MeowShell для Windows x64 — установщик (рекомендуется)](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.7/MeowShell-2.3.0-beta.7-win-x64-setup.exe)

| Версия | Скачать |
|---|---|
| Windows x64, установщик | [Скачать `.exe`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.7/MeowShell-2.3.0-beta.7-win-x64-setup.exe) |
| Windows x64, portable | [Скачать `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.7/MeowShell-2.3.0-beta.7-win-x64-portable.zip) |
| Windows ARM64, установщик | [Скачать `.exe`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.7/MeowShell-2.3.0-beta.7-win-arm64-setup.exe) |
| Windows ARM64, portable | [Скачать `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.7/MeowShell-2.3.0-beta.7-win-arm64-portable.zip) |
| Полный комплект релиза | [Скачать общий `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.7/MeowShell-2.3.0-beta.7-release-bundle.zip) |

[Все файлы релиза и контрольные суммы SHA-256](https://github.com/kimi-1337/meowshell/releases/tag/v2.3.0-beta.7)

Релиз `2.3.0-beta.7` устраняет повторное открытие на Windows и добавляет
настраиваемую панель инструментов, перетаскивание вкладок, отдельный раздел
обновлений и фирменный установщик. Подробности — в [CHANGELOG.md](CHANGELOG.md).
Скачиваемые бинарные файлы соответствуют исходникам своего тега.

MeowShell — приватный и настраиваемый настольный терминал для Windows. Он
объединяет локальные вкладки, SSH, SFTP, сплиты, туннели, мониторинг, темы и
быстрые команды.

В приложении нет телеметрии, слежения, облачной синхронизации и автоматической
отправки crash-отчётов. Сетевые подключения выполняются после действия
пользователя, при явно включённом восстановлении SSH-вкладок и туннелей либо для
периодической проверки версии через GitHub Releases в упакованной Windows-сборке.
Точная политика описана в [PRIVACY.md](PRIVACY.md).

## Статус и совместимость

- Версия: `2.3.0-beta.7`
- Сборки: Windows x64 и Windows ARM64
- Форматы: NSIS-установщик и portable ZIP с каталогом приложения
- Проверенная конфигурация: Windows 10 x64, NVIDIA GPU, AMD CPU
- Интерфейс: русский, английский или автоматический выбор языка системы

Windows x86/32-bit не выпускается: x86 и x32 — одно и то же 32-битное
направление, а текущий набор PTY/runtime-зависимостей не даёт надёжной ia32
сборки. Основная цель — Windows 10/11 x64. ARM64 собирается в CI, но до
runtime-теста на физическом устройстве остаётся экспериментальной.

## Возможности

- локальные `cmd`, PowerShell или произвольный shell;
- SSH по паролю или приватному ключу с проверкой host key;
- SFTP: навигация, атомарные upload/download/редактирование, rename, chmod и защищённое удаление;
- вертикальный и горизонтальный сплит;
- переподключение SSH, локальные туннели и мониторинг Linux-сервера;
- broadcast-ввод, командная палитра, поиск и защита многострочной вставки;
- вставка скриншота/файла как правильно экранированного пути;
- темы, фоны, свои шрифты, плавная анимация текста при вводе/выводе, эффекты ввода и quake-режим;
- поиск по настройкам, локальная диагностика и GPU safe mode;
- уведомления об обновлениях прямо в терминале, ручное скачивание с прогрессом и установка с перезапуском;
- экспорт/импорт конфигурации без секретов, восстановление исправной локальной
  копии и полный сброс без сохранения резервной копии.

## Установка и portable-версия

Скачай файл своей архитектуры в GitHub Releases:

- `*-setup.exe` — обычный интерактивный установщик для текущего пользователя;
- `*-portable.zip` — portable-каталог: распакуй его в постоянную папку и запусти
  `MeowShell.exe`.

Не запускай приложение прямо из временной папки архиватора. Пока сборки не
подписаны, сверяй опубликованную SHA-256 сумму перед запуском. Начиная с
`2.3.0-beta.5`, Windows-сборка также проверяет GitHub Releases в фоне и
показывает уведомление в терминале. Скачивание и установка начинаются только по
кнопке; перед запуском установщика обновлятор сверяет SHA-512 из release manifest.

## Разработка и сборка

Нужны Node.js 22.12+, npm 10+ и, для наиболее полного теста локального PTY,
Windows.

```powershell
npm ci
npm run verify
npm run audit:acceptance
npm audit --audit-level=high
npm start
npm run dist
```

Отдельные форматы: `npm run dist:zip` и `npm run dist:installer`. Результат
появится в `dist/`.

### Подпись Windows-сборок

Репутацию SmartScreen нельзя отключить кодом приложения или установщика. Для
доверенных сборок добавь Authenticode-сертификат в secrets репозитория под
именем `WINDOWS_CSC_LINK` (base64 либо защищённая ссылка), а его пароль — как
`WINDOWS_CSC_KEY_PASSWORD`. Release workflow автоматически подпишет приложение
и установщик и завершится ошибкой при неверной подписи. Файлы `.pfx`, `.p12` и
приватные ключи нельзя коммитить в репозиторий.

## Горячие клавиши

| Сочетание | Действие |
|---|---|
| `Ctrl+Shift+T` | новая локальная вкладка |
| `Ctrl+Shift+W` | закрыть вкладку |
| `Ctrl+Tab` | следующая вкладка |
| `Ctrl+Shift+D` | вертикальный сплит |
| `Ctrl+Shift+E` | горизонтальный сплит |
| `Ctrl+Shift+P` | командная палитра |
| `Ctrl+Shift+B` | broadcast-ввод |
| `Ctrl+F` | поиск |
| `Ctrl+,` | настройки |

## Безопасность и локальные данные

Конфигурация хранится в каталоге данных Electron. Пароли и passphrase шифруются
через Electron `safeStorage` (Windows DPAPI) и не возвращаются renderer-процессу.
Если системное шифрование недоступно, MeowShell не сохраняет секрет открытым
текстом.

При первом SSH-подключении сверь SHA-256 fingerprint сервера через доверенный
канал. Изменившийся ключ известного хоста блокирует соединение до явного
подтверждения. Медиафайлы для SSH попадают под случайным именем в закрытый
каталог `~/.meowshell`.

Уязвимости отправляй только через GitHub Private Vulnerability Reporting по
инструкции [SECURITY.md](SECURITY.md). Никогда не прикладывай пароли, приватные
ключи или неочищенную пользовательскую конфигурацию.

## Ограничения бета-версии

- release-файлы остаются неподписанными до настройки доверенного сертификата в secrets репозитория;
- мониторинг Linux использует `/proc`, `free` и `df`;
- SFTP drag-and-drop загружает файлы, но не каталоги;
- ARM64 ещё не проверена на физическом устройстве.

## Лицензия и автор

Copyright © kimi. Свободное ПО под лицензией [GPL-3.0-only](LICENSE).

Автор: [kimi](https://github.com/kimi-1337)
