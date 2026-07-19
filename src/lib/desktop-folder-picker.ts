export interface FolderSelectionResult {
  cancelled: boolean;
  path: string;
}

export interface DesktopFolderApi {
  selectFolder: () => Promise<FolderSelectionResult>;
  openPrivacySettings?: () => Promise<{ opened: boolean }>;
}

export interface FolderAccessResult {
  readable: boolean;
  name: string;
  error: string | null;
  directoriesChecked: number;
  filesChecked: number;
  symlinksSkipped: number;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Runtime = 'electron' | 'browser';

function getDesktopApi(): DesktopFolderApi | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { repolumeDesktop?: DesktopFolderApi }).repolumeDesktop ?? null;
}

function getRuntime(): Runtime {
  if (typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent)) return 'electron';
  return 'browser';
}

export async function selectProjectFolder(options: {
  desktop?: DesktopFolderApi | null;
  fetcher?: Fetcher;
  runtime?: Runtime;
} = {}): Promise<FolderSelectionResult> {
  const desktop = options.desktop === undefined ? getDesktopApi() : options.desktop;
  if (desktop) return desktop.selectFolder();
  if ((options.runtime ?? getRuntime()) === 'electron') {
    throw new Error('데스크톱 폴더 선택 기능을 불러오지 못했습니다. RepoLume를 완전히 종료한 뒤 다시 실행하거나 최신 버전으로 업데이트해 주세요.');
  }

  const response = await (options.fetcher ?? fetch)('/api/fs/select_folder', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Folder picker failed with HTTP ${response.status}`);
  const data = await response.json() as { path?: string };
  const path = data.path?.trim() ?? '';
  return { cancelled: !path, path };
}

export async function probeFolderAccess(path: string, fetcher: Fetcher = fetch): Promise<FolderAccessResult> {
  const fallbackName = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
  try {
    const params = new URLSearchParams({ path });
    const response = await fetcher(`/api/fs/probe?${params}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({})) as {
      readable?: boolean;
      name?: string;
      error?: string;
      directories_checked?: number;
      files_checked?: number;
      symlinks_skipped?: number;
    };
    if (!response.ok || data.readable !== true) {
      return {
        readable: false,
        name: data.name ?? fallbackName,
        error: data.error ?? `HTTP ${response.status}`,
        directoriesChecked: data.directories_checked ?? 0,
        filesChecked: data.files_checked ?? 0,
        symlinksSkipped: data.symlinks_skipped ?? 0,
      };
    }
    return {
      readable: true,
      name: data.name ?? fallbackName,
      error: null,
      directoriesChecked: data.directories_checked ?? 0,
      filesChecked: data.files_checked ?? 0,
      symlinksSkipped: data.symlinks_skipped ?? 0,
    };
  } catch (error) {
    return {
      readable: false,
      name: fallbackName,
      error: error instanceof Error ? error.message : String(error),
      directoriesChecked: 0,
      filesChecked: 0,
      symlinksSkipped: 0,
    };
  }
}

export async function openPrivacySettings(desktop: DesktopFolderApi | null = getDesktopApi()): Promise<boolean> {
  if (!desktop?.openPrivacySettings) return false;
  const result = await desktop.openPrivacySettings();
  return result.opened;
}
