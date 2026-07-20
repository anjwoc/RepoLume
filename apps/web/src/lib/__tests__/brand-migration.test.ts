import { describe, expect, it } from "vitest";
import { migrateStorageNamespace } from "../brand-migration";

function createStorage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    get length() { return data.size; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
    data,
  };
}

describe("RepoLume browser storage migration", () => {
  it("copies legacy keys without overwriting current values", () => {
    const storage = createStorage({
      localwiki_app_settings: '{"setupComplete":true}',
      localwiki_is_dark: "true",
      repolume_is_dark: "false",
      unrelated: "keep",
    });

    expect(migrateStorageNamespace(storage)).toBe(1);
    expect(storage.data.get("repolume_app_settings")).toBe('{"setupComplete":true}');
    expect(storage.data.get("repolume_is_dark")).toBe("false");
    expect(storage.data.get("unrelated")).toBe("keep");
  });
});
