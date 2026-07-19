const FOLDER_DIALOG_CHANNEL = 'localwiki:select-folder';

function createFolderSelector({ dialog, getParentWindow }) {
  let inFlight = null;

  async function openDialog() {
    const options = {
      title: '프로젝트 폴더 선택',
      buttonLabel: '이 폴더 사용',
      properties: ['openDirectory', 'createDirectory'],
    };
    const parentWindow = getParentWindow();
    const response = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);
    const path = response.filePaths?.[0] || '';
    return { cancelled: response.canceled || !path, path };
  }

  return {
    selectFolder() {
      if (inFlight) return inFlight;
      inFlight = openDialog().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

module.exports = { FOLDER_DIALOG_CHANNEL, createFolderSelector };
