const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // сессии
  createLocal: (opts) => ipcRenderer.invoke('session:create-local', opts),
  createSsh: (cfg) => ipcRenderer.invoke('session:create-ssh', cfg),
  write: (id, data) => ipcRenderer.send('session:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('session:kill', { id }),
  pauseStream: (id) => ipcRenderer.send('session:pause', { id }),
  resumeStream: (id) => ipcRenderer.send('session:resume', { id }),
  tunnelStart: (args) => ipcRenderer.invoke('tunnel:start', args),
  tunnelStop: (args) => ipcRenderer.invoke('tunnel:stop', args),
  monitorStart: (id, interval) => ipcRenderer.send('monitor:start', { id, interval }),
  monitorStop: (id) => ipcRenderer.send('monitor:stop', { id }),
  onMonitorData: (cb) => ipcRenderer.on('monitor:data', (e, p) => cb(p)),
  sshKeygen: (args) => ipcRenderer.invoke('ssh:keygen', args),
  sshInstallKey: (args) => ipcRenderer.invoke('ssh:install-key', args),
  formatSshCommand: (connection) => ipcRenderer.invoke('ssh:format-command', connection),
  quakeRefresh: (s) => ipcRenderer.send('quake:refresh', s),
  pasteMedia: (id) => ipcRenderer.invoke('session:paste-media', { id }),
  onData: (cb) => ipcRenderer.on('session:data', (e, p) => cb(p)),
  onExit: (cb) => ipcRenderer.on('session:exit', (e, p) => cb(p)),

  // SFTP
  sftpList: (id, path) => ipcRenderer.invoke('sftp:list', { id, path }),
  sftpDownload: (id, remotePath, name) => ipcRenderer.invoke('sftp:download', { id, remotePath, name }),
  sftpDownloadDir: (id, remotePath, name) => ipcRenderer.invoke('sftp:download-dir', { id, remotePath, name }),
  // v2.1.1: нативный буфер обмена
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.send('clipboard:write', text),
  sftpUpload: (id, remoteDir) => ipcRenderer.invoke('sftp:upload', { id, remoteDir }),
  sftpMkdir: (id, parent, name) => ipcRenderer.invoke('sftp:mkdir', { id, parent, name }),
  grantUploadFiles: (files) => ipcRenderer.invoke('files:grant-upload', Array.from(files || []).map((file) => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  }).filter(Boolean)),
  sftpUploadGrants: (id, remoteDir, grants) => ipcRenderer.invoke('sftp:upload-grants', { id, remoteDir, grants }),
  onSftpProgress: (cb) => ipcRenderer.on('sftp:progress', (e, p) => cb(p)),

  // конфиг
  getConfig: () => ipcRenderer.invoke('config:get'),
  importTabby: () => ipcRenderer.invoke('config:import-tabby'),
  sftpRename: (id, from, to) => ipcRenderer.invoke('sftp:rename', { id, from, to }),
  sftpChmod: (id, path, mode) => ipcRenderer.invoke('sftp:chmod', { id, path, mode }),
  sftpDelete: (id, path, isDir) => ipcRenderer.invoke('sftp:delete', { id, path, isDir }),
  sftpReadFile: (id, path) => ipcRenderer.invoke('sftp:read-file', { id, path }),
  sftpWriteFile: (id, path, content, version) => ipcRenderer.invoke('sftp:write-file', { id, path, content, version }),
  saveConnection: (conn) => ipcRenderer.invoke('config:save-connection', conn),
  deleteConnection: (id) => ipcRenderer.invoke('config:delete-connection', id),
  saveSettings: (s) => ipcRenderer.invoke('config:save-settings', s),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfigPreview: () => ipcRenderer.invoke('config:import-preview'),
  applyConfigImport: (token, mode) => ipcRenderer.invoke('config:import-apply', { token, mode }),
  resetConfig: (mode) => ipcRenderer.invoke('config:reset', mode),
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  openDiagnosticsPath: (kind) => ipcRenderer.invoke('app:open-path', kind),
  clearSafeMode: () => ipcRenderer.invoke('app:clear-safe-mode'),
  restartApp: () => ipcRenderer.send('app:restart'),
  smokeReady: (result) => ipcRenderer.send('app:smoke-ready', result),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  localResourceUrl: (path, type) => ipcRenderer.invoke('app:local-resource', { path, type }),
  fontsList: () => ipcRenderer.invoke('fonts:list'),

  // кнопки собственной шапки окна
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winMaximizeToggle: () => ipcRenderer.send('win:maximize-toggle'),
  winClose: () => ipcRenderer.send('win:close'),
  onWinMaxState: (cb) => ipcRenderer.on('win:max-state', (e, v) => cb(v)),
})
