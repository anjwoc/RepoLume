// "Ask the Wiki" — DeepWiki-style Q&A grounded in the generated wiki documents.
// v1 strategy (grounding A): inject the full wiki markdown as context and reuse the
// existing /api/chat/stream endpoint with skip_rag=true + is_wiki_generation=true so the
// backend blanks its own system prompt and we fully control grounding from the client.
// No backend changes required.

const APP_SETTINGS_KEY = "repolume_app_settings";

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface WikiPageLite {
  id: string;
  title: string;
  content: string;
}

interface AppSettings {
  provider: string;
  model: string;
  mode: "cli" | "api";
  apiKey?: string;
  language?: string;
}

/** Provider name → CLI agent name (mirrors wiki-generator). */
function providerToCli(provider: string): string {
  if (provider === "google") return "gemini";
  if (provider === "anthropic") return "claude";
  if (provider === "antigravity") return "antigravity";
  return "codex"; // openai and others
}

/** Read the same app settings the wiki generator uses (localStorage). */
function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        provider: s.provider || "google",
        model: s.model || "gemini-2.5-flash",
        mode: (s.mode as "cli" | "api") || "cli",
        apiKey: s.apiKey,
        language: s.language,
      };
    }
  } catch {
    /* ignore malformed settings */
  }
  return { provider: "google", model: "gemini-2.5-flash", mode: "cli" };
}

/** Concatenate the wiki pages into a single grounding context, in the given order. */
export function buildWikiContext(pages: WikiPageLite[]): string {
  return pages
    .filter((p) => p.content && p.content.trim())
    .map((p) => `# ${p.title}\n\n${p.content}`)
    .join("\n\n---\n\n");
}

// ── P2: token guard + page-level retrieval for large wikis ──────────────────
// Budget is in characters (~4 chars/token, matching the backend's rough estimate).
// ~60k chars ≈ 15k tokens of context — bounded for cost/latency, ample for most wikis.
const DEFAULT_BUDGET_CHARS = 60000;

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "of", "to", "in", "on", "for", "and", "or", "how",
  "what", "why", "does", "do", "this", "that", "with", "about", "어떻게", "무엇", "왜",
  "하나요", "인가요", "대해", "에서", "으로", "이런", "그리고",
]);

function pageSize(p: WikiPageLite): number {
  return p.title.length + (p.content?.length || 0) + 12;
}

function questionTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function scorePage(p: WikiPageLite, terms: string[]): number {
  const title = p.title.toLowerCase();
  const content = (p.content || "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 5; // title match weighted high
    let idx = 0;
    let count = 0;
    while ((idx = content.indexOf(term, idx)) !== -1 && count < 8) {
      count++;
      idx += term.length;
    }
    score += count;
  }
  return score;
}

export interface GroundingResult {
  /** Pages selected to ground the answer. */
  pages: WikiPageLite[];
  /** "full" = whole wiki fit the budget; "retrieved" = relevance-selected subset. */
  strategy: "full" | "retrieved";
  /** Total number of non-empty wiki pages. */
  totalPages: number;
}

/**
 * Choose which wiki pages to send as context. If the whole wiki fits the budget, use it all
 * (strategy "full"). Otherwise pick the most relevant pages to the question within the budget
 * (strategy "retrieved") — the caller surfaces this to the user so truncation is never silent.
 */
export function selectWikiContext(
  allPages: WikiPageLite[],
  question: string,
  budgetChars: number = DEFAULT_BUDGET_CHARS,
): GroundingResult {
  const withContent = allPages.filter((p) => p.content && p.content.trim());
  const totalPages = withContent.length;

  const totalChars = withContent.reduce((n, p) => n + pageSize(p), 0);
  if (totalChars <= budgetChars) {
    return { pages: withContent, strategy: "full", totalPages };
  }

  const terms = questionTerms(question);
  const scored = withContent
    .map((p) => ({ p, score: terms.length ? scorePage(p, terms) : 0 }))
    .sort((a, b) => b.score - a.score);

  const picked: WikiPageLite[] = [];
  let used = 0;
  for (const { p } of scored) {
    const size = pageSize(p);
    if (picked.length > 0 && used + size > budgetChars) continue; // always keep at least one
    picked.push(p);
    used += size;
    if (used >= budgetChars) break;
  }

  return { pages: picked, strategy: "retrieved", totalPages };
}

function composePrompt(
  wikiTitle: string,
  wikiContext: string,
  history: AskTurn[],
  question: string,
  language: string,
): string {
  const langLine =
    language === "en"
      ? "Answer in English."
      : "Answer in Korean (한국어); keep technical terms, identifiers, and headings in English.";

  const hist = history.length
    ? "\n## Previous conversation\n" +
      history
        .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
        .join("\n") +
      "\n"
    : "";

  return [
    `You are a documentation assistant for the wiki titled "${wikiTitle}".`,
    `Answer the question using ONLY the wiki content provided below.`,
    `If the answer is not contained in the wiki, clearly say you could not find it in the documentation — never invent facts or rely on outside knowledge.`,
    `When you reference a wiki page, cite it inline as [[Exact Page Title]] using the page titles exactly as they appear in the wiki.`,
    langLine,
    `\n## Wiki content\n${wikiContext}`,
    hist,
    `\n## Question\n${question}`,
  ].join("\n");
}

export interface AskParams {
  projectData: { owner?: string; repo?: string; repo_type?: string } | null;
  wikiTitle: string;
  pages: WikiPageLite[];
  history: AskTurn[];
  question: string;
  onToken: (delta: string) => void;
  signal?: AbortSignal;
}

/**
 * Stream an answer grounded in the wiki. Calls onToken for each streamed chunk and
 * resolves with the full answer text. Throws on HTTP or CLI errors.
 */
export async function askWiki(p: AskParams): Promise<string> {
  const settings = readSettings();
  const language = settings.language || "ko";
  const wikiContext = buildWikiContext(p.pages);
  const content = composePrompt(p.wikiTitle, wikiContext, p.history, p.question, language);

  const requestBody: Record<string, unknown> = {
    repo_url: p.projectData?.repo || p.wikiTitle || "wiki",
    type: p.projectData?.repo_type || "local",
    messages: [{ role: "user", content }],
    model: settings.model,
    provider: settings.provider,
    language,
    skip_rag: true,
    is_wiki_generation: true, // blanks backend system prompt → client controls grounding
    ...(settings.mode === "cli"
      ? { use_cli: true, cli_tool: providerToCli(settings.provider) }
      : {}),
    ...(settings.apiKey ? { api_key: settings.apiKey } : {}),
  };

  const response = await fetch(`/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: p.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(응답 없음)");
    throw new Error(`질의 실패 (HTTP ${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let full = "";

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      p.onToken(chunk);
    }
    full += decoder.decode();
  }

  if (full.includes("CLI Error:")) {
    const msg = full.split("CLI Error:").pop()?.trim() || "CLI 오류";
    throw new Error(msg);
  }

  return full;
}

export interface WikiRagHealth {
  available: boolean;
  model: string;
}

/** Check whether semantic search (local Ollama embeddings) is usable. Never throws. */
export async function checkWikiRagHealth(): Promise<WikiRagHealth> {
  try {
    const res = await fetch(`/api/wiki/rag/health`);
    if (!res.ok) return { available: false, model: "nomic-embed-text" };
    const data = await res.json();
    return { available: !!data.available, model: data.model || "nomic-embed-text" };
  } catch {
    return { available: false, model: "nomic-embed-text" };
  }
}

export interface AskSemanticParams {
  wikiTitle: string;
  pages: WikiPageLite[];
  history: AskTurn[];
  question: string;
  onToken: (delta: string) => void;
  signal?: AbortSignal;
}

/**
 * P3: semantic (embedding) retrieval. Sends ALL wiki pages to the backend, which embeds them
 * with the local Ollama embedder, retrieves the most relevant chunks, and streams the answer.
 */
export async function askWikiSemantic(p: AskSemanticParams): Promise<string> {
  const settings = readSettings();
  const requestBody: Record<string, unknown> = {
    wiki_pages: p.pages.map((pg) => ({ id: pg.id, title: pg.title, content: pg.content || "" })),
    question: p.question,
    wiki_title: p.wikiTitle,
    history: p.history,
    provider: settings.provider,
    model: settings.model,
    language: settings.language || "ko",
    mode: settings.mode,
    ...(settings.apiKey ? { api_key: settings.apiKey } : {}),
  };

  const response = await fetch(`/api/wiki/ask/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: p.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(응답 없음)");
    throw new Error(`의미 검색 질의 실패 (HTTP ${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let full = "";
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      p.onToken(chunk);
    }
    full += decoder.decode();
  }

  if (full.includes("CLI Error:")) {
    const msg = full.split("CLI Error:").pop()?.trim() || "CLI 오류";
    throw new Error(msg);
  }

  return full;
}

export interface AskSourceParams {
  repoPath: string;
  repoType?: string;
  history: AskTurn[];
  question: string;
  onToken: (delta: string) => void;
  signal?: AbortSignal;
}

/**
 * P4: DeepWiki-style source-grounded Q&A. Reuses the existing chat endpoint with skip_rag=false
 * so the backend indexes & retrieves over the actual repository source (no new backend).
 * Requires the original repo path (read from the wiki cache) and a working embedder.
 */
export async function askSource(p: AskSourceParams): Promise<string> {
  const settings = readSettings();
  const messages = [
    ...p.history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: p.question },
  ];

  const requestBody: Record<string, unknown> = {
    repo_url: p.repoPath,
    type: p.repoType || "local",
    messages,
    model: settings.model,
    provider: settings.provider,
    language: settings.language || "ko",
    skip_rag: false, // index + retrieve over the repository source
    ...(settings.mode === "cli"
      ? { use_cli: true, cli_tool: providerToCli(settings.provider) }
      : {}),
    ...(settings.apiKey ? { api_key: settings.apiKey } : {}),
  };

  const response = await fetch(`/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: p.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(응답 없음)");
    throw new Error(`소스 기반 질의 실패 (HTTP ${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let full = "";
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      p.onToken(chunk);
    }
    full += decoder.decode();
  }

  if (full.includes("CLI Error:")) {
    const msg = full.split("CLI Error:").pop()?.trim() || "CLI 오류";
    throw new Error(msg);
  }

  return full;
}

/** Extract [[Page Title]] citations and resolve each to an existing wiki page id. */
export function extractCitations(
  text: string,
  pages: WikiPageLite[],
): { title: string; id: string }[] {
  const titles = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) titles.add(m[1].trim());

  const seen = new Set<string>();
  const out: { title: string; id: string }[] = [];
  for (const title of titles) {
    const lower = title.toLowerCase();
    const page =
      pages.find((p) => p.title.toLowerCase() === lower) ||
      pages.find((p) => p.title.toLowerCase().includes(lower));
    if (page && !seen.has(page.id)) {
      seen.add(page.id);
      out.push({ title: page.title, id: page.id });
    }
  }
  return out;
}

/** Replace inline [[Title]] citation markers with the plain title for display. */
export function stripCitationMarkers(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, "$1");
}
