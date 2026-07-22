# Changelog

## 2.3.0-beta.1

- added complete Russian and English interfaces with automatic system-language detection;
- added an English README and a separate Russian README;
- added configuration export/import without secrets, local diagnostics, backups, reset controls, and first-run onboarding;
- added x64 and ARM64 ZIP and NSIS release targets;
- added privacy and security policies, GPL-3.0-only licensing, CodeQL, Dependabot, and release checks;
- removed the legacy download website deployment and all bot-related release paths;
- marked the project as a beta and documented the currently tested Windows configuration.

## 2.2.2

- Electron переведён на зрелую поддерживаемую ветку 41 после GPU-crash на Windows 10;
- безопасный режим теперь выключает GPU sandbox до запуска Chromium;
- вместо запуска portable из `%TEMP%` выпускается ZIP с обычным каталогом приложения;
- добавлены локальные Electron crash dumps и надёжный перезапуск в safe mode;
- прозрачность терминального canvas отключена для программного рендеринга.

## 2.2.1

- отключён нестабильный WebGL-рендерер по умолчанию;
- добавлено автоматическое однократное восстановление renderer в безопасном режиме;
- Windows PTY теперь принудительно включается и при кросс-сборке из Linux;
- исправлена поставка portable EXE для локальных Windows-терминалов.

## 2.2.0

- добавлена проверка и запоминание SSH host key;
- пароли удалены из renderer-конфигурации, запрещено plaintext-хранение;
- включена строгая Electron sandbox и ограничены IPC, навигация, окна и CSP;
- закрыт path traversal при рекурсивном SFTP-скачивании;
- файлы из clipboard загружаются в закрытый каталог со случайными именами;
- исправлены двойная вставка правой кнопкой и гонка между SFTP-вкладками;
- исправлено восстановление вкладок, мониторинга и автоматических туннелей;
- исправлены повреждённые строки, светлая тема и reduced motion;
- обновлены Electron и electron-builder;
- добавлены lock-файл, unit-тесты, статические проверки и Windows CI;
- документация синхронизирована с текущей версией.
