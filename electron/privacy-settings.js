const PRIVACY_SETTINGS_CHANNEL = 'localwiki:open-privacy-settings';
const FILES_AND_FOLDERS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';

function createPrivacySettingsOpener({ platform, shell }) {
  return async function openPrivacySettings() {
    if (platform !== 'darwin') return { opened: false };
    await shell.openExternal(FILES_AND_FOLDERS_SETTINGS_URL);
    return { opened: true };
  };
}

module.exports = {
  PRIVACY_SETTINGS_CHANNEL,
  FILES_AND_FOLDERS_SETTINGS_URL,
  createPrivacySettingsOpener,
};
