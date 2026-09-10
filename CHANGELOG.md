# Changelog

## 2.3.0-beta.7

- Removed automatic renderer-crash relaunches and explicitly ignore the normal
  Windows `killed` teardown reason, preventing close/reopen loops.
- Added dedicated Interface and Updates settings pages.
- Added drag-to-reorder tabs and configurable toolbar visibility/order.
- Added a setting to hide the quick-command/library bar.
- Removed the duplicate sidebar brand, widened saved-server controls, and
  eliminated their accidental horizontal scrollbar.
- Added branded artwork and metadata for the Windows installer and uninstaller.

## 2.3.0-beta.6

- fixed the custom title-bar close action being mistaken for a renderer crash
  and relaunching MeowShell instead of terminating it;
- replaced immediate restart exits with graceful Electron shutdown so local
  PTY, SSH, tunnel, monitor, and updater resources are released exactly once;
- added a Windows shutdown regression smoke that rejects leftover MeowShell
  processes after the application window closes;
- fixed the Windows 10 taskbar identity by assigning the packaged window icon
  explicitly and matching its AppUserModelID to the installer application ID.

## 2.3.0-beta.5

- added in-terminal update notifications, manual background download progress,
  one-click install/restart, periodic checks, and a settings status/control;
- added SHA-512-verified NSIS update metadata for x64 and ARM64 releases, plus
  regression tests that reject mixed-version or unsafe update manifests;
- fixed all 20 findings from the 2026 security and reliability audit, including
  reconnect input routing, credential binding, guarded native paste, session
  lifecycle, configuration validation, and visible persistence failures;
- made SFTP listing and editing bounded, uploads/downloads atomic, overwrite
  explicit, paste-media permissions verified, and editor conflicts detectable;
- upgraded vulnerable dependency paths (`js-yaml`, `@xmldom/xmldom`, and
  `fast-uri`); `npm audit` now reports zero known vulnerabilities;
- expanded the runtime smoke to exercise a real local PTY with input, output,
  resize, and a nonce; hardened release version checks, x64 artifact smoke, and
  bundle checksums;
- added audit acceptance checks, SFTP regression tests, async key generation,
  OpenSSH-style fingerprints, stricter private-key handling, and lockfile
  integrity verification for cross-compiled Windows PTY packages.

## 2.3.0-beta.4

- added an optional, reduced-motion-aware animation for terminal text input and
  output, with throttling for high-volume streams;
- fixed configuration import dialogs crashing because they addressed the dialog
  wrapper instead of its DOM element;
- added damaged-config quarantine and recovery from the latest valid backup,
  bounded config normalization, and collision-resistant backup names;
- hardened SFTP path normalization, root deletion protection, rename/mkdir
  boundaries, server-provided filenames, recursive download cleanup, and upload
  grants;
- cleaned temporary clipboard screenshots when sessions end and made selected
  local-file capabilities single-use; stale screenshot directories are pruned;
- made full-data reset actually remove backups and local diagnostics without
  silently preserving an encrypted-secrets backup, and aligned the privacy docs;
- escaped custom-font option markup and improved keyboard/dialog accessibility;
- updated Electron to 41.10.5 and js-yaml to 4.3.1, resolving the findings
  reported at the time of that release;
- moved diagnostic logs from the shared temporary directory into private app
  data and pinned GitHub Actions to reviewed commit hashes;
- expanded unit and static regression checks and corrected documented artifact
  names.

## 2.3.0-beta.3

- fixed mouse-wheel scrolling in Claude Code, Codex, and other full-screen TUIs:
  applications with mouse tracking receive native wheel events, while the fallback
  now sends PageUp/PageDown instead of input-history arrow keys;
- exposed the legacy arrow-key modes only as explicit compatibility options;
- local sessions now advertise `xterm-256color`, true color, and MeowShell terminal
  metadata to child CLI applications.

## 2.3.0-beta.2

- fixed all first-run onboarding buttons by binding their click handlers to the
  actual dialog element;
- added a regression check for onboarding dialog wiring.

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
