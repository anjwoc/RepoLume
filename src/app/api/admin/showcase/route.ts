import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const WIKICACHE_DIR = path.join(os.homedir(), '.adalflow', 'wikicache');
const SHOWCASE_DIR = path.join(process.cwd(), 'public', 'showcase-data');
const PROJECTS_JSON = path.join(SHOWCASE_DIR, 'projects.json');

function parseFilename(filename: string) {
  // <product>_cache_{repo_type}_{owner}_{repo}_{language}[_{model}].json
  const prefix = filename.startsWith('repolume_cache_') ? 'repolume_cache_' : 'localwiki_cache_';
  const base = filename.replace(prefix, '').replace(/\.json$/, '');
  const parts = base.split('_');
  const repoType = parts[0];
  const owner = parts[1];

  try {
    const raw = fs.readFileSync(path.join(WIKICACHE_DIR, filename), 'utf-8');
    const data = JSON.parse(raw);
    const model: string | null = data.model ?? null;
    const repo: string = data.repo?.repo ?? parts.slice(2).join('_');
    // Derive language from filename (not JSON content — may be stale)
    let language = data.language ?? 'en';
    const fnPrefix = `${repoType}_${owner}_${repo}_`;
    if (base.startsWith(fnPrefix)) {
      const remainder = base.slice(fnPrefix.length);
      if (model && remainder.endsWith(`_${model}`)) {
        language = remainder.slice(0, -(model.length + 1));
      } else if (!model) {
        language = remainder;
      }
    }
    return {
      id: filename,
      repo,
      owner,
      repo_type: repoType,
      language,
      model,
      pages: Object.keys(data.generated_pages ?? {}).length,
      sections: (data.wiki_structure?.sections ?? []).length,
      submittedAt: fs.statSync(path.join(WIKICACHE_DIR, filename)).mtimeMs,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  if (!fs.existsSync(WIKICACHE_DIR)) return NextResponse.json({ caches: [], selected: [] });

  const caches = fs
    .readdirSync(WIKICACHE_DIR)
    .filter(f => /^(?:repolume|localwiki)_cache_/.test(f) && f.endsWith('.json'))
    .map(parseFilename)
    .filter(Boolean)
    .filter(c => c!.pages > 0)
    .sort((a, b) => b!.submittedAt - a!.submittedAt);

  const currentProjects: { id: string }[] = fs.existsSync(PROJECTS_JSON)
    ? JSON.parse(fs.readFileSync(PROJECTS_JSON, 'utf-8'))
    : [];
  const selected = currentProjects.map(p => p.id);

  return NextResponse.json({ caches, selected });
}

export async function POST(req: NextRequest) {
  const { selected }: { selected: string[] } = await req.json();

  const projects = [];
  const existingWikiFiles = fs.existsSync(SHOWCASE_DIR)
    ? fs.readdirSync(SHOWCASE_DIR).filter(f => f.startsWith('wiki_') && f.endsWith('.json'))
    : [];

  // Remove deselected wiki files
  for (const file of existingWikiFiles) {
    const fileId = file.slice('wiki_'.length, -'.json'.length) + '.json';
    if (!selected.includes(fileId)) {
      fs.unlinkSync(path.join(SHOWCASE_DIR, file));
    }
  }

  // Copy selected caches and build projects list
  for (const id of selected) {
    const src = path.join(WIKICACHE_DIR, id);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(SHOWCASE_DIR, `wiki_${id}.json`));

    const meta = parseFilename(id);
    if (!meta) continue;
    projects.push({
      id,
      owner: meta.owner,
      repo: meta.repo,
      name: `${meta.owner}/${meta.repo}`,
      repo_type: meta.repo_type,
      submittedAt: meta.submittedAt,
      language: meta.language,
      model: meta.model,
    });
  }

  fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
  fs.writeFileSync(PROJECTS_JSON, JSON.stringify(projects, null, 2));

  return NextResponse.json({ ok: true, count: projects.length });
}
