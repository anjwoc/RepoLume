import yaml from 'js-yaml';
import fs from 'fs';

export interface TableRef  { name: string; db: string; }
export interface SpRef     { name: string; db: string; }
export interface CodeRef   { host: string; repo: string; path: string; }

export interface FlowDefinition {
  id: string;
  name: string;
  repos: string[];
  entryClasses: string[];
  tables: TableRef[];
  storedProcs?: SpRef[];
  codeRefs: CodeRef[];
}

export function loadCatalog(catalogPath: string): FlowDefinition[] {
  const raw = fs.readFileSync(catalogPath, 'utf8');
  const parsed = yaml.load(raw) as { flows: FlowDefinition[] };
  return parsed.flows ?? [];
}

export function findFlow(flows: FlowDefinition[], pageId: string): FlowDefinition | null {
  const needle = pageId.toLowerCase();
  return flows.find(f =>
    needle.includes(f.id.toLowerCase()) ||
    needle.includes(f.name.toLowerCase().replace(/\s+/g, '-')),
  ) ?? null;
}
