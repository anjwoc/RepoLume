import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron window drag contract', () => {
  it('marks the wiki header as draggable while controls remain interactive', () => {
    const root = resolve(__dirname, '../../..');
    const viewer = readFileSync(resolve(root, 'src/components/wiki-viewer.tsx'), 'utf8');
    const css = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8');

    expect(viewer).toContain('className="repolume-window-drag"');
    expect(css).toMatch(/\.repolume-window-drag\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
    expect(css).toMatch(/\.repolume-window-drag[\s\S]*?button[\s\S]*?\{[\s\S]*?-webkit-app-region:\s*no-drag/);
  });
});
