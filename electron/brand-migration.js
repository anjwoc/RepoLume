const { cpSync, existsSync } = require('fs');
const path = require('path');

const CURRENT_APP_DIRECTORY = 'RepoLume';
const LEGACY_APP_DIRECTORY = 'LocalWiki';

function prepareUserDataDirectory(appDataRoot, fileSystem = { cpSync, existsSync }) {
  const current = path.join(appDataRoot, CURRENT_APP_DIRECTORY);
  const legacy = path.join(appDataRoot, LEGACY_APP_DIRECTORY);
  if (!fileSystem.existsSync(current) && fileSystem.existsSync(legacy)) {
    fileSystem.cpSync(legacy, current, {
      recursive: true,
      errorOnExist: false,
      preserveTimestamps: true,
    });
    return { current, migrated: true, legacy };
  }
  return { current, migrated: false, legacy };
}

module.exports = {
  CURRENT_APP_DIRECTORY,
  LEGACY_APP_DIRECTORY,
  prepareUserDataDirectory,
};
