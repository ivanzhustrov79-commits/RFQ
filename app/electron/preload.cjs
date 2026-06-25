const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  thunderbird: {
    discover: () => ipcRenderer.invoke('thunderbird:discover'),
    readMbox: (mboxPath, maxEmails, folderName) => ipcRenderer.invoke('thunderbird:readMbox', mboxPath, maxEmails, folderName),
    setSyncedPaths: (paths) => ipcRenderer.invoke('thunderbird:setSyncedPaths', paths),
    onAutoSync: (callback) => ipcRenderer.on('thunderbird:autoSync', (_event, data) => callback(data)),
    onFolderUpdate: (callback) => ipcRenderer.on('thunderbird:folderUpdate', (_event, data) => callback(data)),
    onClearEmails: (callback) => ipcRenderer.on('thunderbird:clearEmails', (_event) => callback()),
    onSyncComplete: (callback) => ipcRenderer.on('thunderbird:syncComplete', (_event, data) => callback(data)),
    onSyncError: (callback) => ipcRenderer.on('thunderbird:syncError', (_event, error) => callback(error)),
    setSyncFromDate: (date) => ipcRenderer.invoke('thunderbird:setSyncFromDate', date),
    listMboxes: () => ipcRenderer.invoke('thunderbird:listMboxes'),
    setSkippedAccounts: (list) => ipcRenderer.invoke('thunderbird:setSkippedAccounts', list),
    listAccounts: () => ipcRenderer.invoke('thunderbird:listAccounts'),
    syncSupplier: (supplierId) => ipcRenderer.invoke('thunderbird:syncSupplier', supplierId),
  },
  suppliers: {
    list: () => ipcRenderer.invoke('suppliers:list'),
  },
  nlp: {
    onResults: (callback) => ipcRenderer.on('nlp:results', (_event, results) => callback(results)),
    onStats: (callback) => ipcRenderer.on('nlp:stats', (_event, stats) => callback(stats)),
  },
});
