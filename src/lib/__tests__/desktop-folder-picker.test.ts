import { describe, expect, it, vi } from 'vitest';

import { probeFolderAccess, selectProjectFolder } from '../desktop-folder-picker';

describe('selectProjectFolder', () => {
  it('uses the Electron bridge without calling the browser fallback', async () => {
    const fallback = vi.fn();
    const result = await selectProjectFolder({
      desktop: {
        selectFolder: async () => ({ cancelled: false, path: '/projects/local-wiki' }),
      },
      fetcher: fallback,
    });

    expect(result).toEqual({ cancelled: false, path: '/projects/local-wiki' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the API picker when running in a normal browser', async () => {
    const result = await selectProjectFolder({
      desktop: null,
      runtime: 'browser',
      fetcher: vi.fn(async () => new Response(JSON.stringify({ path: '/projects/browser' }), { status: 200 })),
    });

    expect(result).toEqual({ cancelled: false, path: '/projects/browser' });
  });

  it('fails immediately instead of hanging on the API fallback when the Electron bridge is missing', async () => {
    const fallback = vi.fn();

    await expect(selectProjectFolder({
      desktop: null,
      runtime: 'electron',
      fetcher: fallback,
    })).rejects.toThrow('데스크톱 폴더 선택 기능');

    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('probeFolderAccess', () => {
  it('checks the selected path through the Python API process', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ readable: true, name: 'local-wiki' }), { status: 200 }));

    const result = await probeFolderAccess('/projects/local wiki', fetcher);

    expect(result).toEqual({
      readable: true,
      name: 'local-wiki',
      error: null,
      directoriesChecked: 0,
      filesChecked: 0,
      symlinksSkipped: 0,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/fs/probe?path=%2Fprojects%2Flocal+wiki', { cache: 'no-store' });
  });

  it('requests the recursive worker preflight instead of a shallow directory check', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      readable: true,
      name: 'local-wiki',
      directories_checked: 12,
      files_checked: 7,
      symlinks_skipped: 1,
    }), { status: 200 }));

    const result = await probeFolderAccess('/projects/local-wiki', fetcher);

    expect(result).toMatchObject({
      readable: true,
      directoriesChecked: 12,
      filesChecked: 7,
      symlinksSkipped: 1,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/fs/probe?path=%2Fprojects%2Flocal-wiki', { cache: 'no-store' });
  });

  it('returns a recoverable denial instead of throwing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 }));

    await expect(probeFolderAccess('/protected', fetcher)).resolves.toEqual({
      readable: false,
      name: 'protected',
      error: 'Permission denied',
      directoriesChecked: 0,
      filesChecked: 0,
      symlinksSkipped: 0,
    });
  });
});
