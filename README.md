# MeowShell 2.3.0 Beta

> **Beta software.** Back up important data before testing. The current build is
> unsigned and may trigger Microsoft Defender SmartScreen.

[Русская версия](README.ru.md)

## Download

### [Download MeowShell for Windows x64 — installer (recommended)](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.2/MeowShell-2.3.0-beta.2-win-x64-setup.exe)

| Package | Download |
|---|---|
| Windows x64 installer | [Download `.exe`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.2/MeowShell-2.3.0-beta.2-win-x64-setup.exe) |
| Windows x64 portable | [Download `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.2/MeowShell-2.3.0-beta.2-win-x64-portable.zip) |
| Windows ARM64 installer | [Download `.exe`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.2/MeowShell-2.3.0-beta.2-win-arm64-setup.exe) |
| Windows ARM64 portable | [Download `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.2/MeowShell-2.3.0-beta.2-win-arm64-portable.zip) |
| Complete release bundle | [Download full `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.2/MeowShell-2.3.0-beta.2-release-bundle.zip) |

[View all release files and SHA-256 checksums](https://github.com/kimi-1337/meowshell/releases/tag/v2.3.0-beta.2)

MeowShell is a private, customizable desktop terminal for Windows. It combines
local shell tabs, SSH, SFTP, split panes, tunnels, monitoring, themes, and quick
commands in one Electron application.

The application contains no telemetry, tracking, cloud synchronization, or
automatic crash upload. Network connections happen only after a user action.
See [PRIVACY.md](PRIVACY.md) for the exact policy.

## Status and compatibility

- Release: `2.3.0-beta.2`
- Packages: Windows x64 and Windows ARM64
- Formats: NSIS installer and extracted portable ZIP
- Confirmed hardware test: Windows 10 x64, NVIDIA GPU, AMD CPU
- Interface: English, Russian, or automatic system-language detection

Windows x86/32-bit is not shipped: x86 and x32 refer to the same 32-bit target,
and the current PTY/runtime dependency set does not provide a reliable ia32
release path. Windows 10/11 x64 is the primary target; ARM64 is built and checked
by CI but should be treated as beta until it receives a real-device test.

## Features

- Local `cmd`, PowerShell, or a custom shell
- SSH with password or private-key authentication
- SSH host-key verification and change detection
- SFTP navigation, upload/download, rename, chmod, removal, and text editing
- Vertical and horizontal split panes
- SSH reconnect, local port forwarding, and optional Linux resource monitoring
- Broadcast input, command palette, terminal search, and guarded multiline paste
- Screenshot/file paste as a correctly quoted local or remote path
- Themes, backgrounds, custom fonts, typing effects, and quake mode
- Settings search, local diagnostics, GPU safe mode, and first-run onboarding
- Secret-free configuration export/import with automatic backups before reset

## Install or run the portable build

Download the artifact for your architecture from GitHub Releases:

- `*-nsis.exe` — interactive per-user installer
- `*-zip.zip` — portable folder; extract it to a permanent directory, then run
  `MeowShell.exe`

Do not run the extracted application from a temporary archive directory. Releases
are currently unsigned; verify the published SHA-256 checksum before running a
downloaded artifact.

## Development

Requirements: Node.js 22.12 or newer, npm 10 or newer, and Windows for the most
representative local-PTY test.

```powershell
npm ci
npm run verify
npm start
```

Build all x64 and ARM64 artifacts:

```powershell
npm run dist
```

Build only one format:

```powershell
npm run dist:zip
npm run dist:installer
```

Generated files are written to `dist/`.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New local terminal |
| `Ctrl+Shift+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+D` | Vertical split |
| `Ctrl+Shift+E` | Horizontal split |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+B` | Toggle broadcast input |
| `Ctrl+F` | Search terminal |
| `Ctrl+,` | Settings |

## Security and local data

Configuration is stored in Electron's application-data directory. Saved passwords
and passphrases are encrypted with Electron `safeStorage` (Windows DPAPI) and are
never returned to the renderer process. If OS encryption is unavailable,
MeowShell refuses to save a plaintext secret.

On first contact, compare the server's SSH SHA-256 fingerprint through a trusted
channel. A changed known-host key blocks the connection until explicitly
confirmed. Remote clipboard media is uploaded under a random name to a private
`~/.meowshell` directory.

Report vulnerabilities through GitHub Private Vulnerability Reporting as
described in [SECURITY.md](SECURITY.md). Never attach credentials, private keys,
unredacted configuration, or production host details to an issue.

## Project layout

```text
src/main/main.js       Electron main process, IPC, PTY, SSH/SFTP
src/main/preload.js    isolated renderer API
src/main/utils.js      config, path, port, and shell-quoting helpers
src/renderer/          HTML, CSS, localization, and interface logic
scripts/               static checks and native PTY packaging helper
test/                  Node unit tests
```

## Known beta limitations

- No automatic updater and no code-signing certificate yet
- Linux resource monitoring expects `/proc`, `free`, and `df`
- SFTP drag-and-drop uploads files, not directories
- ARM64 packages do not yet have a documented physical-device test

## License and author

Copyright © kimi. MeowShell is free software licensed under
[GPL-3.0-only](LICENSE).

Author: [kimi](https://github.com/kimi-1337)
