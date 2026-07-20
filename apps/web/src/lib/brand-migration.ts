interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CURRENT_STORAGE_PREFIX = "repolume_";
export const LEGACY_STORAGE_PREFIX = "localwiki_";

export function migrateStorageNamespace(storage: StorageLike): number {
  const legacyKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_STORAGE_PREFIX)) legacyKeys.push(key);
  }

  let migrated = 0;
  for (const legacyKey of legacyKeys) {
    const currentKey = `${CURRENT_STORAGE_PREFIX}${legacyKey.slice(LEGACY_STORAGE_PREFIX.length)}`;
    if (storage.getItem(currentKey) !== null) continue;
    const value = storage.getItem(legacyKey);
    if (value === null) continue;
    storage.setItem(currentKey, value);
    migrated += 1;
  }
  return migrated;
}

export function migrateLegacyBrowserStorage(): void {
  if (typeof window === "undefined") return;
  try { migrateStorageNamespace(window.localStorage); } catch {}
  try { migrateStorageNamespace(window.sessionStorage); } catch {}
}
