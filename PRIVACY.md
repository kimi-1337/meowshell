# Privacy

MeowShell is designed to work locally and does not include telemetry, analytics,
advertising, tracking, or automatic usage reporting.

## Data stored on your device

MeowShell stores application settings, saved connection profiles, known SSH host
keys, local crash reports, and session state in Electron's application data
directory. Passwords saved by the user are encrypted with Electron `safeStorage`
when the operating system supports it. Exported configuration files never include
saved passwords or other authentication secrets.

## Network access

MeowShell opens network connections only after an explicit user action, such as
starting an SSH/SFTP connection or opening a link. There is no background
telemetry, account service, cloud synchronization, or automatic updater.

## Crash diagnostics

Crash dumps and logs stay on the local device. They are never uploaded
automatically. A user may inspect, delete, or intentionally share them when
reporting a bug.

## Removing local data

Use **Settings → Diagnostics & data → Reset all data**, or remove MeowShell's
application data directory after closing the application.
