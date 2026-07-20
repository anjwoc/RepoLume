import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fixed Korean wiki language policy', () => {
  it('does not offer a language selector during initial setup', () => {
    const root = resolve(__dirname, '../../..');
    const wizard = readFileSync(resolve(root, 'src/components/setup-wizard.tsx'), 'utf8');

    expect(wizard).not.toContain('위키 언어 선택');
    expect(wizard).not.toContain('setSelectedLanguages');
    expect(wizard).toContain('language: "ko"');
    expect(wizard).toContain('languages: ["ko"]');
  });

  it('keeps generation and regeneration output fixed to Korean', () => {
    const root = resolve(__dirname, '../../..');
    const generator = readFileSync(resolve(root, 'src/lib/wiki-generator.ts'), 'utf8');

    expect(generator).toContain('FORCED_WIKI_LANGUAGE: string | null = "ko"');
  });
});
