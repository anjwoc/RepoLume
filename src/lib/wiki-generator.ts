import { emitTaskEvent } from "./taskStreamClient";
import mermaid from 'mermaid';
import { normalizeMarkdownContent } from "./markdown-normalize";
import { fetchEventStream } from "./sse-fetcher";

// Topic-specific page requirements. The generic prompt only *suggests* diagrams,
// so the model defaults to `graph TD` and never emits sequence/ER diagrams. These
// blocks MANDATE the diagram type + concrete content per topic. Routed by keywords
// in the section title + page title (Korean and English).
function topicRequirements(sectionTitle: string, pageTitle: string): string {
  const text = `${sectionTitle} ${pageTitle}`.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => text.includes(k));
  if (has('database', 'schema', 'data model', 'datamodel', 'erd', 'entity', 'persistence', 'table', '데이터', '스키마', '테이블', '엔티티'))
    return `
### MANDATORY for this DATA MODEL / DATABASE page
- Include an \`erDiagram\` of the tables/entities with primary keys, foreign keys, and relationship cardinality (e.g. \`CUSTOMER ||--o{ ORDER : places\`), extracted from the JPA entities / schema in the source files.
- Include per-table column tables: column / type / constraints / description.
- Add a paragraph explaining the main joins and relationships. Base everything strictly on the source files — do NOT invent.`;
  if (has('batch', 'scheduler', 'cron', 'job', '배치'))
    return `
### MANDATORY for this BATCH JOB page
- Include a \`sequenceDiagram\` of the job execution order (Scheduler/Trigger → JobLauncher → Step → ItemReader → ItemProcessor → ItemWriter → commit), making chunk boundaries and the transaction commit point explicit.
- Include a table of the job's schedule/tuning: job name / cron or trigger / chunk-size / idempotency / retry & skip policy.
- Add a dedicated paragraph on failure & re-run behavior.`;
  if (has('event', 'consumer', 'producer', 'kafka', 'message', 'stream', 'queue', 'topic', '이벤트', '메시지'))
    return `
### MANDATORY for this EVENT-PROCESSING page
- Include a \`sequenceDiagram\` of the message flow (Producer → Broker/topic → Consumer group → Handler → ack/commit) with the retry / DLQ branch on failure shown explicitly.
- Include a table of topics/messages: topic / payload schema / consumer group / partition key.
- Add a dedicated paragraph on idempotency, duplicate handling, and dead-letter (DLQ) policy.`;
  if (has('api', 'backend', 'controller', 'service', 'gateway', 'endpoint', '백엔드'))
    return `
### MANDATORY for this BACKEND API page
- Include an endpoint table: HTTP method / path / auth / request & response summary.
- Include a \`sequenceDiagram\` for at least one key endpoint (Client → Controller → Service → Repository/external call → Response).
- Add a dedicated paragraph on the authentication & authorization flow.`;
  return '';
}

// Temporary fixed default until the per-wiki language setting is properly wired.
// While set, all generation/regeneration/fix output uses this language regardless
// of the (possibly stale) per-wiki language tag. Set to null to restore honoring
// each wiki's own language. Centralized here so the choice lives in ONE place.
export const FORCED_WIKI_LANGUAGE: string | null = "ko";

/** Resolve the effective language: the forced default if set, else the wiki's own. */
export function effectiveWikiLanguage(language?: string): string {
  return FORCED_WIKI_LANGUAGE ?? language ?? "ko";
}

/** Single source of truth for the language instruction. Default is Korean-base
 *  with English technical terms; only an explicit "en" yields English-only. */
export function wikiLanguageInstruction(language?: string): string {
  const lang = effectiveWikiLanguage(language);
  if (lang === "en") {
    return "IMPORTANT: The wiki content MUST be written ENTIRELY in English. Do NOT include Korean translations.";
  }
  if (lang === "bilingual") {
    return "IMPORTANT: The wiki content MUST be generated bilingually (Korean with English technical terms preserved and explained).";
  }
  return "IMPORTANT: The main explanations and natural language descriptions MUST be written in Korean (한국어). However, you MUST KEEP essential technical terms, system components, variable names, and core section headers (e.g., Overview, Introduction, Deployment) in English.";
}

const STRICT_FORMAT_RULES = `
### CRITICAL OUTPUT FORMAT RULES
1. Output ONLY the raw generated content (Markdown or JSON depending on the task).
2. DO NOT include any conversational text, pleasantries, intro, or outro (e.g. "Here is the wiki page...", "Based on your prompt...").
3. DO NOT repeat, leak, or mention the prompt instructions, system messages, or these rules in your output.
4. Your response must begin immediately with the actual content.
`;


/** 프로바이더 이름 → CLI 에이전트 이름 매핑 */
function providerToCli(provider: string): string {
  if (provider === "google") return "gemini";
  if (provider === "anthropic") return "claude";
  return "codex"; // openai 및 기타
}

/** 경과 시간을 ms 단위로 반환 */
function elapsed(startMs: number): number {
  return Date.now() - startMs;
}

/** 단계별 emit 헬퍼 */
async function emitStep(
  streamId: string,
  type: string,
  phase: string,
  message: string,
  data?: Record<string, unknown>
) {
  await emitTaskEvent(streamId, { type, phase, message, data });
}

export async function runWikiGeneration(
  projectPath: string,
  streamId: string,
  outputLanguage: string = "ko",
  testMode: boolean = false,
  provider: string = "google",
  model: string = "gemini-2.5-flash",
  apiKey?: string,
  mode: "cli" | "api" = "cli",
  cliTool?: string,
  showcaseMode?: boolean,
) {
  const owner = "local";
  // 경로 끝 슬래시 제거 후 디렉토리명 추출
  const rawName = projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  // 허용 문자(영문·숫자·한글·하이픈·언더스코어·점) 외 모두 _로 치환, 연속 _ 정리
  const repo = rawName
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "")
    || "project";

  const repo_type = "local";
  const language = outputLanguage;

  const languageInstruction = wikiLanguageInstruction(language);

  const pipelineStart = Date.now();

  try {
    // ──────────────────────────────────────────────────────────
    // Phase 1: 파일 스캔 & 구조 분석
    // ──────────────────────────────────────────────────────────
    const t1 = Date.now();
    await emitStep(streamId, 'phase_start', 'scan', '📂 프로젝트 파일 스캔 시작...');

    let file_tree = '';
    let readme = '';
    try {
      const resStructure = await fetch(`/local_repo/structure?path=${encodeURIComponent(projectPath)}`);
      if (!resStructure.ok) {
        const errText = await resStructure.text().catch(() => '(응답 없음)');
        throw new Error(`파일 스캔 실패 (HTTP ${resStructure.status}): ${errText}`);
      }
      const structData = await resStructure.json();
      file_tree = structData.file_tree || '';
      readme = structData.readme || '';
      const fileCount = file_tree.split('\n').filter(Boolean).length;
      await emitStep(streamId, 'phase_complete', 'scan',
        `✅ 파일 스캔 완료 — ${fileCount}개 파일 발견 (${elapsed(t1)}ms)`,
        { file_count: fileCount, elapsed_ms: elapsed(t1) }
      );
    } catch (err) {
      await emitStep(streamId, 'error', 'scan',
        `❌ 파일 스캔 실패: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // Phase 2: AI 구조 생성
    // ──────────────────────────────────────────────────────────
    const t2 = Date.now();
    await emitStep(streamId, 'phase_start', 'structure', '🧠 AI 위키 구조 분석 중...');

    // Payload 크기 제한 (Next.js API Route 한도 및 에러 방지)
    const MAX_FILE_TREE_LENGTH = 50000;
    if (file_tree.length > MAX_FILE_TREE_LENGTH) {
      file_tree = file_tree.substring(0, MAX_FILE_TREE_LENGTH) + "\n... (truncated for payload size limit)";
    }

    let structurePrompt = `Analyze this repository and create a wiki structure for it.
1. The complete file tree of the project:
<file_tree>
${file_tree}
</file_tree>

2. The README file of the project:
<readme>
${readme}
</readme>

I want to create a wiki for this repository. Determine the most logical structure for a wiki based on the repository's content.
${languageInstruction}

### Naming Conventions & Rules
1. DO NOT USE hyphens (\`-\`) in section titles, page titles, or IDs. Use spaces for titles, and camelCase or snake_case for IDs.
2. ${effectiveWikiLanguage(language) === 'ko' ? 'Write section and page titles entirely in Korean (한국어). Do not mix English and Korean in titles.' : 'Write section and page titles entirely in English.'}
3. Make the structure clean, readable, and professional.

Create a structured Table of Contents (wiki structure) with the following main sections:
- Overview (general information about the project)
- System Architecture (how the system is designed)
- Core Features (key functionality)
- Data Management/Flow: If applicable, how data is stored, processed, accessed, and managed.
- Frontend Components (UI elements, if applicable.)
- Backend Systems (server-side components)
- Deployment/Infrastructure (how to deploy)

${showcaseMode ? `### SHOWCASE EXTRACTION MODE (ADMIN)
This is a SHOWCASE EXTRACTION. Do NOT generate a full wiki structure. Based solely on the <file_tree> provided above, deduce 3 to 5 core architectural modules and create a maximum of 10 pages total.
CRITICAL: DO NOT use any tools to search or read files. You MUST guess the structure entirely from the file tree and output the JSON immediately.` : ''}

CRITICAL INSTRUCTION: DO NOT write the actual wiki page content! You are ONLY generating the Table of Contents structure.
Your entire output MUST be a single, valid JSON object matching this exact structure (do not include markdown formatting or backticks around the JSON):
{
  "title": "Project Wiki",
  "description": "...",
  "rootSections": ["section1", "section2"],
  "sections": [
    { "id": "section1", "title": "...", "pages": ["page1"] }
  ],
  "pages": [
    { "id": "page1", "title": "...", "filePaths": ["src/index.ts"] }
  ]
}

OUTPUT RULES (STRICT): Respond with ONLY the JSON object — nothing else.
- Your FIRST character MUST be "{" and your LAST character MUST be "}".
- No preamble, no explanation, no headings (e.g. "## Overview"), no prose before or after the JSON.
- No markdown code fences (no \`\`\`).
- Do NOT write any wiki page content — output ONLY the table-of-contents structure.`;

    await emitStep(streamId, 'agent_log', 'structure', 'AI에게 위키 구조 생성을 요청합니다...');

    // is_wiki_generation=true: blank the backend chat-persona system prompt so the agent
    // returns ONLY the JSON structure instead of narrating wiki content.
    const buildRequestBody = (content: string) => ({
      repo_url: projectPath,
      type: repo_type,
      stream_id: streamId,
      messages: [{ role: 'user', content }],
      model,
      provider,
      language,
      skip_rag: true,
      is_wiki_generation: true,
      ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
    });

    const streamStructure = async (content: string): Promise<string> => {
      const out = await fetchEventStream(`/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(content)),
      }, null);
      if (out.includes("CLI Error:")) {
        throw new Error(out.split("CLI Error:").pop()!.trim());
      }
      return out;
    };

    // Tolerant JSON-object extraction: strips ```json fences and any leading/trailing prose
    // by taking the outermost { ... } span.
    const extractJsonObject = (text: string): string | null => {
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const body = fence ? fence[1] : text;
      const first = body.indexOf('{');
      const last = body.lastIndexOf('}');
      if (first === -1 || last === -1 || last <= first) return null;
      return body.slice(first, last + 1);
    };

    const STRICT_SUFFIX = '\n\nREMINDER: Output ONLY the JSON object. Your FIRST character must be "{" and your LAST "}". No prose, no headings, no markdown fences, no wiki content.';

    let wikiStructure: any = null;
    let lastErr = '';
    for (let attempt = 0; attempt < 2 && !wikiStructure; attempt++) {
      let structureContent = '';
      try {
        structureContent = await streamStructure(attempt === 0 ? structurePrompt : structurePrompt + STRICT_SUFFIX);
      } catch (err) {
        await emitStep(streamId, 'error', 'structure',
          `❌ AI 구조 분석 실패: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
      const jsonStr = extractJsonObject(structureContent);
      if (jsonStr) {
        try {
          wikiStructure = JSON.parse(jsonStr);
          if (!wikiStructure.id) wikiStructure.id = "wiki";
          if (!wikiStructure.description) wikiStructure.description = `${repo} wiki`;
        } catch (e) {
          lastErr = `JSON 파싱 오류: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        lastErr = `AI 응답에서 JSON을 찾을 수 없음. 응답 미리보기: ${structureContent.slice(0, 200)}`;
      }
      if (!wikiStructure && attempt === 0) {
        await emitStep(streamId, 'agent_log', 'structure',
          '⚠️ JSON 추출 실패 — 더 엄격한 지시로 1회 재시도합니다...');
      }
    }

    if (!wikiStructure) {
      await emitStep(streamId, 'error', 'structure', `❌ 위키 구조 JSON 파싱 실패: ${lastErr}`);
      throw new Error(`위키 구조 파싱 실패: ${lastErr}`);
    }

    const pageCount = (wikiStructure.pages || []).length + (wikiStructure.items ? wikiStructure.items.reduce((acc: number, item: any) => acc + (item.children?.length || 1), 0) : 0);
    const sectionCount = (wikiStructure.sections || []).length + (wikiStructure.items?.length || 0);
    await emitStep(streamId, 'phase_complete', 'structure',
      `✅ 위키 구조 분석 완료 — ${sectionCount}개 섹션, ${pageCount}개 페이지 (${elapsed(t2)}ms)`,
      { page_count: pageCount, section_count: sectionCount, elapsed_ms: elapsed(t2) }
    );

    // ──────────────────────────────────────────────────────────
    // Phase 3: 페이지 콘텐츠 생성
    // ──────────────────────────────────────────────────────────
    const t3 = Date.now();
    
    // Normalize agent output if it returned 'items' instead of 'pages'/'sections'
    if (!wikiStructure.pages && wikiStructure.items) {
      wikiStructure.pages = [];
      wikiStructure.sections = [];
      wikiStructure.rootSections = [];
      wikiStructure.items.forEach((item: any, i: number) => {
          const secId = item.name || `section_${i}`;
          wikiStructure.rootSections.push(secId);
          
          const secPages: string[] = [];
          if (item.children && item.children.length > 0) {
              item.children.forEach((child: any, j: number) => {
                  const pageId = child.name || `${secId}_page_${j}`;
                  secPages.push(pageId);
                  wikiStructure.pages.push({
                      id: pageId,
                      title: child.title || pageId,
                      filePaths: child.filePaths || [],
                      content: child.prompt || ""
                  });
              });
          } else {
              const pageId = item.name || `page_${i}`;
              secPages.push(pageId);
              wikiStructure.pages.push({
                  id: pageId,
                  title: item.title || pageId,
                  filePaths: item.filePaths || [],
                  content: item.prompt || ""
              });
          }
          
          wikiStructure.sections.push({
              id: secId,
              title: item.title || secId,
              pages: secPages
          });
      });
    }

    const actualPageCount = (wikiStructure.pages || []).length;
    await emitStep(streamId, 'phase_start', 'generation', `📝 ${actualPageCount}개 페이지 콘텐츠 생성 시작...`);

    const generatedPages: Record<string, any> = {};
    let pagesToGenerate = wikiStructure.pages || [];
    const decoder = new TextDecoder();

    if (testMode && pagesToGenerate.length > 0) {
      await emitStep(streamId, 'agent_log', 'generation', '⚠️ 테스트 모드: 첫 번째 페이지만 생성합니다.');
      pagesToGenerate = pagesToGenerate.slice(0, 1);
      wikiStructure.pages = pagesToGenerate;
      if (wikiStructure.sections) {
        wikiStructure.sections = wikiStructure.sections.map((sec: any) => ({
          ...sec,
          pages: sec.pages.filter((pid: string) => pagesToGenerate.some((p: any) => p.id === pid))
        })).filter((sec: any) => sec.pages.length > 0);
      }
    }

    let successPages = 0;
    let failPages = 0;

    for (const page of pagesToGenerate) {
      const tPage = Date.now();
      await emitStep(streamId, 'page_start', 'generation',
        `📄 "${page.title}" 페이지 생성 중... (${successPages + failPages + 1}/${pagesToGenerate.length})`,
        { page_id: page.id, page_title: page.title }
      );

      const sourceFilesText = page.filePaths && page.filePaths.length > 0
        ? `Source files to base content on:\n${page.filePaths.join('\n')}\n\nEnsure you cite the source files explicitly.`
        : `Analyze the repository codebase to gather relevant information for this topic.`;

      const sectionTitle = (wikiStructure.sections || []).find((s: any) => (s.pages || []).includes(page.id))?.title || '';
      const topicReq = topicRequirements(sectionTitle, page.title);

      const pagePrompt = `You are an expert technical writer and software architect.
Your task is to generate a comprehensive and accurate technical wiki page in Markdown format.

Topic: "${page.title}"
${sourceFilesText}

Use Mermaid diagrams where appropriate.
${topicReq}

### Mermaid Diagram Rules
1. **Choose the Best Direction:** Use \`graph TD\` (Top-Down) for hierarchical structures or \`graph LR\` (Left-Right) for pipelines and data flows. Choose the direction that naturally minimizes crossing lines.
2. **Structured Layout with Subgraphs:** You MUST heavily use \`subgraph\` blocks to logically group related nodes into layers or components (e.g., "Core Interfaces", "CLI Layer", "API Clients", "External Endpoints"). This is CRITICAL for creating clean, professional architecture diagrams and preventing spaghetti lines.
3. **Subgraph Syntax:** NEVER use quotes directly for subgraph labels in a way that breaks syntax (e.g., \`subgraph ID "Label"\`). Instead, use the format \`subgraph ID ["Label"]\` or simply avoid quotes and special characters in subgraph IDs.
4. **Node Formatting & Quoting:** You MUST wrap ALL node labels in double quotes to prevent syntax errors, especially if they contain special characters (like \`()\`, \`@\`, \`/\`, space) or HTML tags like \`<br>\`. Example: \`NodeID["Label text <br> (Extra Info)"]\`. NEVER use literal newline characters (\\\\n) inside labels. Keep relationships concise.
5. **Eliminate Spaghetti Lines:** Minimize crossing edges. By grouping nodes into logical subgraphs and strictly routing dependencies layer-by-layer, you must avoid chaotic cross-references.

${languageInstruction}
${STRICT_FORMAT_RULES}`;

      const pageReqBody = {
        repo_url: projectPath,
        type: repo_type,
        stream_id: streamId,
        messages: [{ role: 'user', content: pagePrompt }],
        model,
        provider,
        language,
        skip_rag: true,
        is_wiki_generation: true,
        ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      };

      let pageContent = '';
      try {
        pageContent = await fetchEventStream('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pageReqBody)
        }, page.id);
        
        pageContent = normalizeMarkdownContent(pageContent);

          // --- 다이어그램 검수 및 자가 수정 (Self-Correction) 레이어 ---
          const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
          const matches = [...pageContent.matchAll(mermaidRegex)];
          if (matches.length > 0) {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
            for (let i = 0; i < matches.length; i++) {
              const fullMatch = matches[i][0];
              const diagramCode = matches[i][1];
              try {
                await mermaid.parse(diagramCode);
              } catch (parseError: any) {
                const errMsg = parseError.message || String(parseError);
                await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 구문 오류 감지, 자가 수정 시도 중...`);

                const fixPrompt = `The following Mermaid diagram has a syntax error:\n\n${errMsg}\n\nOriginal Diagram:\n\`\`\`mermaid\n${diagramCode}\n\`\`\`\n\nFix the syntax error. CRITICAL: You MUST wrap all node labels in double quotes if they contain parentheses, brackets, special characters, or HTML tags (e.g., Change \`ID[Text (info)]\` to \`ID["Text (info)"]\`). Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.
${STRICT_FORMAT_RULES}`;
                const fixReqBody = { ...pageReqBody, messages: [{ role: 'user', content: fixPrompt }] };

                try {
                  const fixResp = await fetch(`/api/chat/stream`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fixReqBody)
                  });
                  if (fixResp.ok && fixResp.body) {
                    let fixedContent = '';
                    const fReader = fixResp.body.getReader();
                    while (true) {
                      const { done, value } = await fReader.read();
                      if (done) break;
                      fixedContent += decoder.decode(value, { stream: true });
                    }
                    fixedContent += decoder.decode();
                    const fixedMatch = fixedContent.match(/```mermaid\n([\s\S]*?)\n```/i);
                    if (fixedMatch) {
                      pageContent = pageContent.replace(fullMatch, fixedMatch[0]);
                      await emitStep(streamId, 'agent_log', 'generation', `✅ 다이어그램 자동 복구 성공!`);
                    }
                  }
                } catch (e) {
                  await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 복구 실패: 원본 유지됨`);
                }
              }
            }
          }
          // --- 검수 레이어 끝 ---

          generatedPages[page.id] = {
            id: page.id,
            title: page.title,
            content: pageContent,
            filePaths: page.filePaths || [],
            importance: page.importance || 'medium',
            relatedPages: page.relatedPages || [],
          };
          successPages++;
          await emitStep(streamId, 'page_complete', 'generation',
            `✅ "${page.title}" 완료 (${elapsed(tPage)}ms, ${pageContent.length}자)`,
            { page_id: page.id, content_length: pageContent.length, elapsed_ms: elapsed(tPage) }
          );
        
      } catch (err) {
        failPages++;
        const errMsg = err instanceof Error ? err.message : String(err);
        await emitStep(streamId, 'error', 'generation',
          `❌ "${page.title}" 페이지 생성 실패: ${errMsg}`,
          { page_id: page.id, error: errMsg }
        );
        // 한 페이지 실패해도 계속 진행 (빈 콘텐츠로 저장)
        generatedPages[page.id] = {
          id: page.id,
          title: page.title,
          content: `# ${page.title}\n\n> ⚠️ 생성 실패: ${errMsg}`,
          filePaths: page.filePaths || [],
          importance: page.importance || 'medium',
          relatedPages: page.relatedPages || [],
        };
      }
    }

    await emitStep(streamId, 'phase_complete', 'generation',
      `✅ 페이지 생성 완료 — ${successPages}개 성공, ${failPages}개 실패 (${elapsed(t3)}ms)`,
      { success: successPages, failed: failPages, elapsed_ms: elapsed(t3) }
    );

    // ──────────────────────────────────────────────────────────
    // Phase 4: 캐시 저장
    // ──────────────────────────────────────────────────────────
    const t4 = Date.now();
    await emitStep(streamId, 'phase_start', 'save', '💾 위키 캐시 저장 중...');

    // 백엔드 Pydantic 검증을 통과하기 위해 wikiStructure.pages 내부 요소들도
    // 필수 필드(content, importance 등)가 모두 포함된 완전한 객체로 덮어씌움
    if (wikiStructure.pages) {
      wikiStructure.pages = wikiStructure.pages.map((p: any) => generatedPages[p.id] || p);
    }

    const cachePayload = {
      repo: { owner, repo, type: repo_type, localPath: projectPath, repoUrl: projectPath },
      language,
      wiki_structure: wikiStructure,
      generated_pages: generatedPages,
      provider,
      model
    };

    try {
      const cacheResp = await fetch(`/api/wiki_cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cachePayload)
      });

      if (!cacheResp.ok) {
        const errBody = await cacheResp.text().catch(() => '(응답 없음)');
        throw new Error(`캐시 저장 실패 (HTTP ${cacheResp.status}): ${errBody}`);
      }

      const cacheResult = await cacheResp.json().catch(() => ({}));
      await emitStep(streamId, 'phase_complete', 'save',
        `✅ 캐시 저장 완료 (${elapsed(t4)}ms)`,
        { elapsed_ms: elapsed(t4), result: cacheResult }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await emitStep(streamId, 'error', 'save', `❌ 캐시 저장 실패: ${errMsg}`);
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // 완료
    // ──────────────────────────────────────────────────────────
    await emitStep(streamId, 'complete', 'save',
      `🎉 위키 생성 완료! 총 소요시간: ${elapsed(pipelineStart)}ms`,
      {
        total_elapsed_ms: elapsed(pipelineStart),
        pages_generated: successPages,
        pages_failed: failPages,
      }
    );

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await emitStep(streamId, 'error', 'error',
      `💥 파이프라인 실패: ${errMsg}`,
      { error: errMsg, elapsed_ms: elapsed(pipelineStart) }
    );
    throw error;
  }
}
export async function translateWikiGeneration(
  projectPath: string,
  streamId: string,
  baseLanguage: string,
  targetLanguage: string,
  provider: string = "google",
  model: string = "gemini-2.5-flash",
  apiKey?: string,
  mode: "cli" | "api" = "cli",
  cliTool?: string,
) {
  const owner = "local";
  const rawName = projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  const repo = rawName
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "")
    || "project";

  const repo_type = "local";
  const pipelineStart = Date.now();

  try {
    // 1. 캐시 불러오기
    await emitStep(streamId, 'phase_start', 'scan', `📂 기준 언어(${baseLanguage}) 캐시 로드 중...`);
    const cacheRes = await fetch(`/api/wiki_cache?owner=${owner}&repo=${repo}&repo_type=${repo_type}&language=${baseLanguage}`);

    if (!cacheRes.ok) {
      throw new Error(`기준 캐시 로드 실패: ${cacheRes.statusText}`);
    }
    const cacheData = await cacheRes.json();
    if (!cacheData || !cacheData.wiki_structure || !cacheData.generated_pages) {
      throw new Error(`유효하지 않은 캐시 데이터 형식입니다.`);
    }

    await emitStep(streamId, 'phase_complete', 'scan', `✅ 기준 캐시 로드 완료`, { elapsed_ms: elapsed(pipelineStart) });

    // 2. 구조 번역
    const t2 = Date.now();
    await emitStep(streamId, 'phase_start', 'structure', `🧠 구조를 ${targetLanguage}로 번역 중...`);

    const structurePrompt = `Translate the following JSON wiki structure into ${targetLanguage}.
Keep the JSON structure, keys, IDs, and filePaths exactly the same.
Only translate the "title" and "description" fields.

JSON Data:
${JSON.stringify(cacheData.wiki_structure, null, 2)}
`;

    const requestBody = {
      repo_url: projectPath,
      type: repo_type,
      stream_id: streamId,
      messages: [{ role: 'user', content: structurePrompt }],
      model,
      provider,
      language: targetLanguage,
      skip_rag: true,
      ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
    };

    let structureContent = '';
    const response = await fetch(`/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`구조 번역 실패`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        structureContent += decoder.decode(value, { stream: true });
      }
      structureContent += decoder.decode();
    }

    let translatedStructure: any = JSON.parse(JSON.stringify(cacheData.wiki_structure));
    try {
      const match = structureContent.match(/\{[\s\S]*\}/);
      if (match) {
        // SSE 청크 안에 래핑되어 있을 경우를 대비하여 중첩 파싱 (또는 직접 파싱)
        let parsed = JSON.parse(match[0]);
        // OpenAI chunk format 인지 확인
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
          const innerMatch = parsed.choices[0].delta.content.match(/\{[\s\S]*\}/);
          if (innerMatch) parsed = JSON.parse(innerMatch[0]);
        }
        if (parsed.title) {
          translatedStructure = parsed;
        }
      }
    } catch (e) {
      await emitStep(streamId, 'agent_log', 'structure', `⚠️ 구조 파싱 실패, 원본 유지`);
    }

    await emitStep(streamId, 'phase_complete', 'structure', `✅ 위키 구조 번역 완료`, { elapsed_ms: elapsed(t2) });

    // 3. 페이지 본문 번역
    const t3 = Date.now();
    await emitStep(streamId, 'phase_start', 'generate', `📝 본문을 ${targetLanguage}로 번역 중...`);

    const translatedPages: Record<string, any> = {};
    const pagesList = translatedStructure.pages || [];
    let successPages = 0;
    let failPages = 0;

    for (let i = 0; i < pagesList.length; i++) {
      const page = pagesList[i];
      await emitStep(streamId, 'agent_log', 'generate', `[${i + 1}/${pagesList.length}] 번역 중: ${page.id}...`);

      const originalPage = cacheData.generated_pages[page.id];
      if (!originalPage) {
        translatedPages[page.id] = { ...page, content: "Content not found." };
        failPages++;
        continue;
      }

      const pagePrompt = `Translate the following technical wiki document into ${targetLanguage}.
CRITICAL RULES:
1. Translate all natural language text.
2. DO NOT translate technical keywords, variable names, class names, or code blocks.
3. DO NOT break Markdown formatting.
4. DO NOT translate Mermaid diagram definitions (\`\`\`mermaid ... \`\`\`). Keep the diagram logic intact.

Original Content:
${originalPage.content}
`;

      let pageContent = '';
      try {
        const pageReqBody = { ...requestBody, messages: [{ role: 'user', content: pagePrompt }] };
        const pRes = await fetch(`/api/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pageReqBody)
        });

        if (!pRes.ok) throw new Error("API 에러");

        const pReader = pRes.body?.getReader();
        const pDecoder = new TextDecoder();
        if (pReader) {
          while (true) {
            const { done, value } = await pReader.read();
            if (done) break;
            pageContent += pDecoder.decode(value, { stream: true });
          }
          pageContent += pDecoder.decode();
        }

        let finalContent = pageContent;
        // Parse SSE chunk format if needed
        try {
          const match = pageContent.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
              finalContent = parsed.choices[0].delta.content;
            }
          }
        } catch (e) { }

        finalContent = normalizeMarkdownContent(finalContent);
        if (finalContent.length < 10) throw new Error("번역된 내용이 너무 짧음");

        translatedPages[page.id] = { ...originalPage, title: page.title || originalPage.title, content: finalContent };
        successPages++;
      } catch (err) {
        await emitStep(streamId, 'agent_log', 'generate', `⚠️ ${page.id} 번역 실패, 원본 유지`);
        translatedPages[page.id] = originalPage;
        failPages++;
      }
    }

    await emitStep(streamId, 'phase_complete', 'generate', `✅ 본문 번역 완료 (${successPages} 성공, ${failPages} 실패)`, { elapsed_ms: elapsed(t3) });

    // 4. 저장
    const t4 = Date.now();
    await emitStep(streamId, 'phase_start', 'save', `💾 번역본 저장 중...`);

    const saveBody = {
      repo: { owner, repo, type: repo_type },
      language: targetLanguage,
      wiki_structure: translatedStructure,
      generated_pages: translatedPages
    };

    const saveRes = await fetch('/api/wiki_cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saveBody)
    });

    if (!saveRes.ok) throw new Error(`저장 실패: ${saveRes.statusText}`);

    await emitStep(streamId, 'phase_complete', 'save', `✅ 저장 완료`, { elapsed_ms: elapsed(t4) });
    await emitStep(streamId, 'complete', 'save', `🎉 다국어(${targetLanguage}) 번역 완료! 소요시간: ${elapsed(pipelineStart)}ms`, {
      total_elapsed_ms: elapsed(pipelineStart)
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await emitStep(streamId, 'error', 'error', `💥 번역 실패: ${errMsg}`, { error: errMsg });
    throw error;
  }
}

export async function regenerateWikiPage({
  streamId,
  projectPath,
  repo_type,
  model,
  provider,
  mode,
  cliTool,
  apiKey,
  language,
  page,
  customPrompt
}: {
  streamId: string;
  projectPath: string;
  repo_type: string;
  model: string;
  provider: string;
  mode: string;
  cliTool?: string;
  apiKey?: string;
  language: string;
  page: any;
  customPrompt: string;
}): Promise<string> {
  const t0 = Date.now();
  await emitStep(streamId, 'phase_start', 'generation', `🔄 "${page.title}" 페이지 재생성 시작...`);

  const languageInstruction = wikiLanguageInstruction(language);

  const sourceFilesText = page.filePaths && page.filePaths.length > 0
    ? `Source files to base content on:\n${page.filePaths.join('\n')}\n\nEnsure you cite the source files explicitly.`
    : `Analyze the repository codebase to gather relevant information for this topic.`;

  let pagePrompt = `You are an expert technical writer and software architect.
Your task is to generate a comprehensive and accurate technical wiki page in Markdown format.

Topic: "${page.title}"
${sourceFilesText}

Use Mermaid diagrams where appropriate.
${topicRequirements('', page.title)}

### Mermaid Diagram Rules
1. ALWAYS use \`graph TD\` (Top-Down) or \`graph TB\` for flowcharts to prevent spaghetti diagrams. DO NOT use \`LR\` unless absolutely necessary for a very simple linear flow.
2. Group related nodes using \`subgraph\` to keep the diagram clean and avoid crossing lines.
3. NEVER use quotes directly for subgraph labels in a way that breaks syntax (e.g., \`subgraph ID "Label"\`). Instead, use the format \`subgraph ID ["Label"]\` or simply avoid quotes and special characters in subgraph IDs.
4. Node Formatting & Quoting: You MUST wrap ALL node labels in double quotes to prevent syntax errors, especially if they contain special characters (like \`()\`, \`@\`, \`/\`, space) or HTML tags like \`<br>\`. Example: \`NodeID["Label text <br> (Extra Info)"]\`. NEVER use literal newline characters (\\\\n) inside labels. Keep relationships concise.
6. STRICTLY AVOID SPAGHETTI DIAGRAMS: Minimize the number of crossing edges. Create a strict hierarchical flow from top to bottom. Do NOT create chaotic cross-references or circular dependencies between distant subgraphs.

${languageInstruction}
${STRICT_FORMAT_RULES}`;

  pagePrompt += `\n\n### ORIGINAL WIKI PAGE CONTENT\n\`\`\`markdown\n${page.content}\n\`\`\``;

  if (customPrompt && customPrompt.trim() !== '') {
    pagePrompt += `\n\n### USER REVIEW / CUSTOM INSTRUCTION\nThe user has requested the following changes or specific focus for this regeneration:\n"${customPrompt}"\n\nYou MUST regenerate the entire wiki page by applying these instructions to the original content. Output ONLY the markdown content.`;
  } else {
    pagePrompt += `\n\n### INSTRUCTION\nPlease review, improve, and rewrite the original wiki page content making it more comprehensive and professional. Ensure all formatting is correct. Output ONLY the markdown content without conversational text.`;
  }

  const pageReqBody = {
    repo_url: projectPath,
    type: repo_type,
    stream_id: streamId,
    messages: [{ role: 'user', content: pagePrompt }],
    model,
    provider,
    language,
    skip_rag: true,
    is_wiki_generation: true,
    ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
  };

  let pageContent = '';
  const decoder = new TextDecoder();

  try {
    pageContent = await fetchEventStream('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pageReqBody)
    }, page.id);
    
    pageContent = normalizeMarkdownContent(pageContent);

      // --- 다이어그램 검수 및 자가 수정 (Self-Correction) 레이어 ---
      const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
      const matches = [...pageContent.matchAll(mermaidRegex)];
      if (matches.length > 0) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        for (let i = 0; i < matches.length; i++) {
          const fullMatch = matches[i][0];
          const diagramCode = matches[i][1];
          try {
            await mermaid.parse(diagramCode);
          } catch (parseError: any) {
            const errMsg = parseError.message || String(parseError);
            await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 구문 오류 감지, 자가 수정 시도 중...`);

            const fixPrompt = `The following Mermaid diagram has a syntax error:\n\n${errMsg}\n\nOriginal Diagram:\n\`\`\`mermaid\n${diagramCode}\n\`\`\`\n\nFix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.
${STRICT_FORMAT_RULES}`;
            const fixReqBody = { ...pageReqBody, messages: [{ role: 'user', content: fixPrompt }] };

            try {
              const fixResp = await fetch(`/api/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fixReqBody)
              });
              if (fixResp.ok && fixResp.body) {
                let fixedContent = '';
                const fReader = fixResp.body.getReader();
                while (true) {
                  const { done, value } = await fReader.read();
                  if (done) break;
                  fixedContent += decoder.decode(value, { stream: true });
                }
                fixedContent += decoder.decode();
                const fixedMatch = fixedContent.match(/```mermaid\n([\s\S]*?)\n```/i);
                if (fixedMatch) {
                  pageContent = pageContent.replace(fullMatch, fixedMatch[0]);
                  await emitStep(streamId, 'agent_log', 'generation', `✅ 다이어그램 자동 복구 성공!`);
                }
              }
            } catch (e) {
              await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 복구 실패: 원본 유지됨`);
            }
          }
        }
      }
      // --- 검수 레이어 끝 ---

      await emitStep(streamId, 'page_complete', 'generation', `✅ "${page.title}" 재생성 완료`, { elapsed_ms: Date.now() - t0 });
      return pageContent;
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await emitStep(streamId, 'error', 'generation', `💥 재생성 실패: ${errMsg}`, { error: errMsg });
    throw error;
  }
}
