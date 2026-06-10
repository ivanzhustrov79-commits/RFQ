const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  thunderbird: {
    discover: () => ipcRenderer.invoke('thunderbird:discover'),
    readMbox: (mboxPath, maxEmails, folderName) => ipcRenderer.invoke('thunderbird:readMbox', mboxPath, maxEmails, folderName),
    setSyncedPaths: (paths) => ipcRenderer.invoke('thunderbird:setSyncedPaths', paths),
    onAutoSync: (callback) => ipcRenderer.on('thunderbird:autoSync', (_event, data) => callback(data)),
    onFolderUpdate: (callback) => ipcRenderer.on('thunderbird:folderUpdate', (_event, data) => callback(data)),
    onSyncError: (callback) => ipcRenderer.on('thunderbird:syncError', (_event, error) => callback(error)),
  },
  suppliers: {
    list: () => ipcRenderer.invoke('suppliers:list'),
  },
  nlp: {
    onResults: (callback) => ipcRenderer.on('nlp:results', (_event, results) => callback(results)),
    onStats: (callback) => ipcRenderer.on('nlp:stats', (_event, stats) => callback(stats)),
  },
});
