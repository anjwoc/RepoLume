const { contextBridge, ipcRenderer } = require('electron');
const FOLDER_DIALOG_CHANNEL = 'repolume:select-folder';
const PRIVACY_SETTINGS_CHANNEL = 'repolume:open-privacy-settings';

contextBridge.exposeInMainWorld('repolumeDesktop', {
  selectFolder: () => ipcRenderer.invoke(FOLDER_DIALOG_CHANNEL),
  openPrivacySettings: () => ipcRenderer.invoke(PRIVACY_SETTINGS_CHANNEL),
});
