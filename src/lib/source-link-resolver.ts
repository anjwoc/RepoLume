export interface GitRoot {
  prefix: string;
  name: string;
  localPath?: string;
  webUrl?: string | null;
  branch: string;
  files?: string[];
}

const SOURCE_EXTENSION = /\.(java|ts|tsx|js|jsx|kt|kts|py|go|xml|yaml|yml|json|properties|gradle|sql|rs|c|cpp|h|hpp|cs|swift|rb|php|sh|bash|toml)$/i;

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function parseSourcePath(rawPath: string): { path: string; line: number | null } {
  let value = rawPath.trim().replace(/^[`<"']+|[`>"']+$/g, '');
  try { value = decodeURIComponent(value); } catch { /* retain the original path */ }
  value = value.replace(/^file:\/\//i, '');
  value = value.split(/[?#]/, 1)[0];
  const lineMatch = value.match(/:(\d+)(?:-(\d+))?$/);
  const line = lineMatch ? Number(lineMatch[1]) : null;
  if (lineMatch) value = value.slice(0, -lineMatch[0].length);
  return { path: normalizeSlashes(value).replace(/^\.\//, ''), line };
}

export function isSourceFilePath(rawPath: string): boolean {
  const { path } = parseSourcePath(rawPath.replace(/^Source:\s*/i, ''));
  const basename = path.split('/').pop() || '';
  if (!path || /^\.[a-z0-9]+$/i.test(basename)) return false;
  return SOURCE_EXTENSION.test(basename) && basename.slice(0, basename.lastIndexOf('.')).length > 0;
}

function trackedCandidate(root: GitRoot, rawPath: string, linkType: 'blob' | 'tree'): string {
  const normalized = normalizeSlashes(rawPath);
  const localRoot = root.localPath ? normalizeSlashes(root.localPath).replace(/\/$/, '') : '';
  const prefix = normalizeSlashes(root.prefix || '').replace(/^\/+|\/+$/g, '');
  const candidates: string[] = [];

  if (localRoot && (normalized === localRoot || normalized.startsWith(localRoot + '/'))) {
    candidates.push(normalized.slice(localRoot.length).replace(/^\/+/, ''));
  }
  const relative = normalized.replace(/^\/+/, '');
  if (prefix && (relative === prefix || relative.startsWith(prefix + '/'))) {
    candidates.push(relative.slice(prefix.length).replace(/^\/+/, ''));
  }
  if (relative === root.name || relative.startsWith(root.name + '/')) {
    candidates.push(relative.slice(root.name.length).replace(/^\/+/, ''));
  }
  candidates.push(relative);

  const files = root.files?.map(normalizeSlashes) ?? [];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (files.length === 0) return candidate;
    if (linkType === 'blob' && files.includes(candidate)) return candidate;
    if (linkType === 'tree' && files.some(file => file === candidate || file.startsWith(candidate + '/'))) return candidate;
  }

  if (linkType === 'blob' && files.length > 0) {
    const suffix = relative.replace(/^.*?([^/]+(?:\/[^/]+)*)$/, '$1');
    const matches = files.filter(file => file === suffix || file.endsWith('/' + suffix));
    if (matches.length === 1) return matches[0];
  }
  return '';
}

export function resolveSourceLink(
  rawPath: string,
  roots: GitRoot[] | null | undefined,
  linkType: 'blob' | 'tree' = 'blob',
): string {
  if (!roots?.length) return '';
  const { path, line } = parseSourcePath(rawPath);
  if (!path) return '';

  const sortedRoots = [...roots].sort((a, b) => b.prefix.length - a.prefix.length);
  const normalizedPath = normalizeSlashes(path);
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const explicitRoots = sortedRoots.filter(root => {
    const localRoot = root.localPath ? normalizeSlashes(root.localPath).replace(/\/$/, '') : '';
    const prefix = normalizeSlashes(root.prefix || '').replace(/^\/+|\/+$/g, '');
    return Boolean(
      (localRoot && (normalizedPath === localRoot || normalizedPath.startsWith(localRoot + '/')))
      || (prefix && (relativePath === prefix || relativePath.startsWith(prefix + '/')))
      || relativePath === root.name
      || relativePath.startsWith(root.name + '/'),
    );
  });
  const candidates = explicitRoots.length > 0 ? explicitRoots : sortedRoots;
  const resolved = new Set<string>();
  for (const root of candidates) {
    if (!root.webUrl) continue;
    const relative = trackedCandidate(root, path, linkType);
    if (!relative) continue;
    const encodedPath = relative.split('/').map(encodeURIComponent).join('/');
    const lineFragment = linkType === 'blob' && line ? `#L${line}` : '';
    resolved.add(`${root.webUrl.replace(/\/$/, '')}/${linkType}/${root.branch || 'main'}/${encodedPath}${lineFragment}`);
  }
  return resolved.size === 1 ? [...resolved][0] : '';
}

export function repairSourceUrl(rawUrl: string, roots: GitRoot[] | null | undefined): string | null {
  if (!roots?.length) return null;
  try {
    const url = new URL(rawUrl);
    const marker = url.pathname.match(/\/(blob|tree)\/[^/]+\/(.+)$/);
    if (!marker) return null;
    const pointsAtKnownRepository = roots.some(root => {
      if (!root.webUrl) return false;
      try {
        const rootUrl = new URL(root.webUrl);
        return rootUrl.origin === url.origin
          && rootUrl.pathname.replace(/\/$/, '') === url.pathname.split(/\/(?:blob|tree)\//, 1)[0];
      } catch {
        return false;
      }
    });
    const pointsIntoKnownPrefix = roots.some(root => {
      const prefix = normalizeSlashes(root.prefix || '').replace(/^\/+|\/+$/g, '');
      return Boolean(prefix && (marker[2] === prefix || marker[2].startsWith(prefix + '/')));
    });

    if (!pointsAtKnownRepository && !pointsIntoKnownPrefix) return null;
    const repaired = resolveSourceLink(
      marker[2] + url.hash.replace(/^#L/, ':'),
      roots,
      marker[1] as 'blob' | 'tree',
    );
    if (repaired) return repaired;

    // Empty string means this is one of our repository links but no tracked target exists.
    // Callers must render it as non-clickable text instead of preserving a known 404 URL.
    return '';
  } catch {
    return null;
  }
}
