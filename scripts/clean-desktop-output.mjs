import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKTOP_OUTPUT_DIRECTORY = 'dist';
const LEGACY_OUTPUT_PATTERN = /^dist-electron(?:$|[-.])/;

function assertSafeTopLevelTarget(projectRoot, name) {
  const target = resolve(projectRoot, name);
  if (dirname(target) !== projectRoot || basename(target) !== name) {
    throw new Error(`Refusing to remove an unsafe desktop output path: ${target}`);
  }
  return target;
}

export function cleanDesktopOutputs(projectRoot, logger = console.log) {
  const resolvedRoot = resolve(projectRoot);
  const entries = readdirSync(resolvedRoot, { withFileTypes: true });
  const legacyNames = entries
    .filter(entry => (
      (entry.isDirectory() || entry.isSymbolicLink())
      && LEGACY_OUTPUT_PATTERN.test(entry.name)
    ))
    .map(entry => entry.name);
  const names = [DESKTOP_OUTPUT_DIRECTORY, ...legacyNames];
  const removed = [];
  const trashRoot = join(resolvedRoot, 'build', '.desktop-output-trash');

  for (const [index, name] of names.entries()) {
    const target = assertSafeTopLevelTarget(resolvedRoot, name);
    if (!existsSync(target)) continue;
    mkdirSync(trashRoot, { recursive: true });
    const quarantined = join(trashRoot, `${name}-${process.pid}-${Date.now()}-${index}`);
    renameSync(target, quarantined);
    rmSync(quarantined, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
    removed.push(name);
    logger(`Removed previous desktop output: ${name}/`);
  }

  rmSync(trashRoot, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });

  if (removed.length === 0) logger('No previous desktop output to remove.');
  return removed;
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  cleanDesktopOutputs(resolve(import.meta.dirname, '../apps/desktop'));
}
