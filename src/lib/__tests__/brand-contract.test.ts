import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');

describe('RepoLume public brand contract', () => {
  it('uses the RepoLume desktop identity', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

    expect(packageJson.name).toBe('repolume');
    expect(packageJson.build.productName).toBe('RepoLume');
    expect(packageJson.build.appId).toBe('com.repolume.desktop');
  });

  it('positions the current product as a wiki generator without future-feature claims', () => {
    const publicCopy = [
      readFileSync(resolve(root, 'README.md'), 'utf8'),
      readFileSync(resolve(root, 'README.kr.md'), 'utf8'),
      readFileSync(resolve(root, 'src/app/layout.tsx'), 'utf8'),
      readFileSync(resolve(root, 'src/components/home-screen.tsx'), 'utf8'),
    ].join('\n');

    expect(publicCopy).toContain('RepoLume');
    expect(publicCopy).toMatch(/wiki|위키/i);
    expect(publicCopy).not.toMatch(/RAG Search|search your codebase|LLM 질의|AI-ready knowledge base/i);
    expect(publicCopy).not.toContain('LocalWiki');
  });
});
