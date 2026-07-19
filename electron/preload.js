const { contextBridge, ipcRenderer } = require('electron');
const FOLDER_DIALOG_CHANNEL = 'localwiki:select-folder';
const PRIVACY_SETTINGS_CHANNEL = 'localwiki:open-privacy-settings';

contextBridge.exposeInMainWorld('localwikiDesktop', {
  selectFolder: () => ipcRenderer.invoke(FOLDER_DIALOG_CHANNEL),
  openPrivacySettings: () => ipcRenderer.invoke(PRIVACY_SETTINGS_CHANNEL),
});
