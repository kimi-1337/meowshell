<p align="center">
  <img src="assets/logo.png" width="150" alt="MeowShell cat logo">
</p>

<h1 align="center">MeowShell</h1>

<p align="center">
  A privacy-first Windows terminal for local shells, SSH, SFTP, and focused remote work.
</p>

<p align="center">
  <a href="https://github.com/kimi-1337/meowshell/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kimi-1337/meowshell/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/kimi-1337/meowshell/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/kimi-1337/meowshell/actions/workflows/codeql.yml/badge.svg"></a>
  <a href="https://github.com/kimi-1337/meowshell/releases/tag/v2.3.0-beta.5"><img alt="Release 2.3.0 beta 5" src="https://img.shields.io/badge/release-2.3.0--beta.5-f59e0b"></a>
  <a href="LICENSE"><img alt="GPL-3.0-only" src="https://img.shields.io/badge/license-GPL--3.0--only-2ea44f"></a>
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="README.ru.md">Русский</a>
</p>

> **Beta software.** Back up important data before testing. The current build is
> unsigned and may trigger Microsoft Defender SmartScreen.

[Русская версия](README.ru.md)

## Download

### [Download MeowShell for Windows x64 — installer (recommended)](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.5/MeowShell-2.3.0-beta.5-win-x64-setup.exe)

| Package | Download |
|---|---|
| Windows x64 installer | [Download `.exe`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.5/MeowShell-2.3.0-beta.5-win-x64-setup.exe) |
| Windows x64 portable | [Download `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.5/MeowShell-2.3.0-beta.5-win-x64-portable.zip) |
| Windows ARM64 installer | [Download `.exe`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.5/MeowShell-2.3.0-beta.5-win-arm64-setup.exe) |
| Windows ARM64 portable | [Download `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.5/MeowShell-2.3.0-beta.5-win-arm64-portable.zip) |
| Complete release bundle | [Download full `.zip`](https://github.com/kimi-1337/meowshell/releases/download/v2.3.0-beta.5/MeowShell-2.3.0-beta.5-release-bundle.zip) |

[View all release files and SHA-256 checksums](https://github.com/kimi-1337/meowshell/releases/tag/v2.3.0-beta.5)

Release `2.3.0-beta.5` contains the audit hardening and in-app updater listed in
[CHANGELOG.md](CHANGELOG.md). Downloadable binaries correspond to their tagged
source.

MeowShell is a privacy-first, customizable desktop terminal for Windows. It combines
local shell tabs, SSH, SFTP, split panes, tunnels, monitoring, themes, and quick
commands in one Electron application.

The application contains no telemetry, tracking, cloud synchronization, or
automatic crash upload. Network connections happen after a user action, when
the user has explicitly enabled startup restoration for SSH tabs and tunnels,
or for the periodic GitHub Releases version check in packaged Windows builds.
See [PRIVACY.md](PRIVACY.md) for the exact policy.

## Status and compatibility

- Release: `2.3.0-beta.5`
- Packages: Windows x64 and Windows ARM64
- Formats: NSIS installer and extracted portable ZIP
- Confirmed hardware test: Windows 10 x64, NVIDIA GPU, AMD CPU
- Interface: English, Russian, or automatic system-language detection

Windows x86/32-bit is not shipped: x86 and x32 refer to the same 32-bit target,
and the current PTY/runtime dependency set does not provide a reliable ia32
release path. Windows 10/11 x64 is the primary target; ARM64 is built by CI but
should be treated as experimental until it receives a real-device runtime test.

## Features

- Local `cmd`, PowerShell, or a custom shell
- SSH with password or private-key authentication
- SSH host-key verification and change detection
- SFTP navigation, atomic upload/download/edit, rename, chmod, and guarded removal
- Vertical and horizontal split panes
- SSH reconnect, local port forwarding, and optional Linux resource monitoring
- Broadcast input, command palette, terminal search, and guarded multiline paste
- Screenshot/file paste as a correctly quoted local or remote path
- Themes, backgrounds, custom fonts, smooth input/output text animation, typing effects, and quake mode
- Settings search, local diagnostics, GPU safe mode, and first-run onboarding
- In-terminal update notices with explicit download, progress, and install/restart controls
- Secret-free configuration export/import, recovery from a valid local backup,
  and a deliberate no-backup full-data reset

## Install or run the portable build

Download the artifact for your architecture from GitHub Releases:

- `*-setup.exe` — interactive per-user installer
- `*-portable.zip` — portable folder; extract it to a permanent directory, then run
  `MeowShell.exe`

Do not run the extracted application from a temporary archive directory. Releases
are currently unsigned; verify the published SHA-256 checksum before running a
downloaded artifact. Windows builds from `2.3.0-beta.5` onward also check GitHub
Releases in the background and show an in-terminal prompt. Download and
installation require an explicit click; the updater verifies the release
manifest's SHA-512 before launch.

## Development

Requirements: Node.js 22.12 or newer, npm 10 or newer, and Windows for the most
representative local-PTY test.

```powershell
npm ci
npm run verify
npm run audit:acceptance
npm audit --audit-level=high
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
src/main/updater.js    guarded update state, download, and installation controller
src/main/preload.js    isolated renderer API
src/main/utils.js      config, path, port, and shell-quoting helpers
src/main/sftp-utils.js bounded and atomic SFTP file operations
src/renderer/          HTML, CSS, localization, and interface logic
scripts/               static checks and native PTY packaging helper
test/                  Node unit tests
audit/                 baseline findings and remediation acceptance checks
```

## Known beta limitations

- Release binaries do not have a code-signing certificate yet
- Linux resource monitoring expects `/proc`, `free`, and `df`
- SFTP drag-and-drop uploads files, not directories
- ARM64 packages do not yet have a documented physical-device test

## License and author

Copyright © kimi. MeowShell is free software licensed under
[GPL-3.0-only](LICENSE).

Author: [kimi](https://github.com/kimi-1337)
