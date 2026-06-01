const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  thunderbird: {
    discover: () => ipcRenderer.invoke('thunderbird:discover'),
    readMbox: (mboxPath, maxEmails) => ipcRenderer.invoke('thunderbird:readMbox', mboxPath, maxEmails),
  },
});
