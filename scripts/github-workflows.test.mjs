import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const packageMetadata = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);

function actionSetupBlocks(workflow) {
  const lines = workflow.split('\n');
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('uses: pnpm/action-setup@')) continue;

    const indent = lines[index].search(/\S/);
    const block = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextIndent = lines[cursor].search(/\S/);
      if (nextIndent !== -1 && nextIndent <= indent) break;
      block.push(lines[cursor]);
    }
    blocks.push(block.join('\n'));
  }

  return blocks;
}

test('GitHub workflows let packageManager select the pnpm version', () => {
  assert.match(packageMetadata.packageManager, /^pnpm@/);

  for (const workflowName of ['ci.yml', 'release-desktop.yml']) {
    const workflow = readFileSync(
      join(projectRoot, '.github', 'workflows', workflowName),
      'utf8',
    );

    for (const block of actionSetupBlocks(workflow)) {
      assert.doesNotMatch(
        block,
        /^\s*version:/m,
        `${workflowName} must not duplicate package.json#packageManager`,
      );
    }
  }
});
