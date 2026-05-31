import sys

with open('src/components/wiki-viewer.tsx', 'r') as f:
    lines = f.readlines()

# 1. Add state variables
state_idx = -1
for i, line in enumerate(lines):
    if 'const [showRegenModal, setShowRegenModal] = useState(false);' in line:
        state_idx = i + 1
        break

if state_idx != -1:
    lines.insert(state_idx, """  const [brokenDiagrams, setBrokenDiagrams] = useState<{pageId: string, chartCode: string}[]>([]);
  const [isBatchFixing, setIsBatchFixing] = useState(false);
  const [batchFixProgress, setBatchFixProgress] = useState({ current: 0, total: 0 });
""")

# 2. Add mermaid parsing in useEffect
useEffect_idx = -1
for i, line in enumerate(lines):
    if 'setGeneratedPages(cachedData.generated_pages);' in line:
        useEffect_idx = i + 1
        break

if useEffect_idx != -1:
    lines.insert(useEffect_idx, """
          setTimeout(async () => {
            try {
              const mermaidModule = await import('mermaid');
              const mermaid = mermaidModule.default;
              mermaid.initialize({ startOnLoad: false });
              const broken = [];
              for (const [pageId, pageData] of Object.entries(cachedData.generated_pages)) {
                const content = (pageData as WikiPage).content;
                const matches = content.matchAll(/```(?:mermaid)\\n([\\s\\S]*?)\\n```/gi);
                for (const match of matches) {
                  const chartCode = match[1];
                  try {
                    await mermaid.parse(chartCode);
                  } catch (e) {
                    broken.push({ pageId, chartCode });
                  }
                }
              }
              setBrokenDiagrams(broken);
            } catch (e) {
              console.error("Failed to check diagrams:", e);
            }
          }, 1000);
""")

# 3. Update handleFixDiagram signature and prompt
for i, line in enumerate(lines):
    if 'const handleFixDiagram = async (chartCode: string) => {' in line:
        lines[i] = '  const handleFixDiagram = async (chartCode: string, customInstruction?: string, targetPageId?: string) => {\n'
        break

for i, line in enumerate(lines):
    if 'const currentPageData = generatedPages[selectedPage];' in line:
        lines[i] = '    const pageIdToFix = targetPageId || selectedPage;\n    const currentPageData = generatedPages[pageIdToFix];\n'
        break

prompt_start = -1
prompt_end = -1
for i, line in enumerate(lines):
    if 'const fixPrompt = `The following Mermaid diagram has a syntax error.' in line:
        prompt_start = i
        break

if prompt_start != -1:
    for i in range(prompt_start, len(lines)):
        if '${chartCode}' in lines[i]:
            prompt_end = i + 1
            break

    if prompt_end != -1:
        lines[prompt_start:prompt_end+1] = ["""      const fixPrompt = customInstruction
        ? `Modify the following Mermaid diagram according to the user's instruction.
User Instruction: ${customInstruction}
Output ONLY the modified diagram inside a \\`\\`\\`mermaid ... \\`\\`\\` block. Do not add any conversational text.

Original Diagram:
\\`\\`\\`mermaid
${chartCode}
\\`\\`\\``
        : `The following Mermaid diagram has a syntax error.
Fix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Output ONLY the corrected diagram inside a \\`\\`\\`mermaid ... \\`\\`\\` block. Do not add any conversational text.

Original Diagram:
\\`\\`\\`mermaid
${chartCode}
\\`\\`\\``;
"""]

for i, line in enumerate(lines):
    if 'const newGeneratedPages = { ...generatedPages, [selectedPage]: updatedPage };' in line:
        lines[i] = '        const newGeneratedPages = { ...generatedPages, [pageIdToFix]: updatedPage };\n'
        break

# 4. Add handleFixAllDiagrams
handleFix_end_idx = -1
for i, line in enumerate(lines):
    if 'alert(`다이어그램 복구 실패: ${e.message}`);' in line:
        handleFix_end_idx = i + 3
        break

batch_fix_logic = """
  const handleFixAllDiagrams = async () => {
    if (brokenDiagrams.length === 0 || !projectData || !wikiStructure) return;
    setIsBatchFixing(true);
    setBatchFixProgress({ current: 0, total: brokenDiagrams.length });

    try {
      let currentGeneratedPages = { ...generatedPages };
      
      let apiKey = ""; let useCli = true; let cliTool = "gemini"; let provider = "google"; let model = "gemini-3.1-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const settings = JSON.parse(raw);
            apiKey = settings.apiKey || "";
            useCli = settings.useCli ?? true;
            cliTool = settings.cliTool || "gemini";
            provider = settings.provider || "google";
            model = settings.model || "gemini-3.1-flash";
          } catch (e) {}
        }
      }

      for (let i = 0; i < brokenDiagrams.length; i++) {
        const { pageId, chartCode } = brokenDiagrams[i];
        setBatchFixProgress({ current: i + 1, total: brokenDiagrams.length });
        
        const fixPrompt = `The following Mermaid diagram has a syntax error.
Fix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Output ONLY the corrected diagram inside a \\`\\`\\`mermaid ... \\`\\`\\` block. Do not add any conversational text.

Original Diagram:
\\`\\`\\`mermaid
${chartCode}
\\`\\`\\``;

        const pageReqBody = {
          repo_url: `${projectData.owner}/${projectData.repo}`,
          type: projectData.repo_type,
          stream_id: crypto.randomUUID(),
          messages: [{ role: 'user', content: fixPrompt }],
          model, provider, language: currentLang, skip_rag: true, is_wiki_generation: true, use_cli: useCli, cli_tool: cliTool, ...(apiKey ? { api_key: apiKey } : {})
        };

        const fixResp = await fetch(`/api/chat/stream`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pageReqBody)
        });

        if (fixResp.ok && fixResp.body) {
          let fixedContent = '';
          const decoder = new TextDecoder();
          const reader = fixResp.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fixedContent += decoder.decode(value, { stream: true });
          }
          fixedContent += decoder.decode();

          const match = fixedContent.match(/```mermaid\\n([\\s\\S]*?)\\n```/i) || fixedContent.match(/```\\n([\\s\\S]*?)\\n```/i);
          let newDiagramCode = match ? match[1] : fixedContent.trim();
          newDiagramCode = newDiagramCode.replace(/^```(mermaid)?\\n/i, '').replace(/\\n```$/, '').trim();

          if (newDiagramCode) {
            const oldContent = currentGeneratedPages[pageId].content;
            const newPageContent = oldContent.replace(chartCode, newDiagramCode);
            if (newPageContent !== oldContent) {
              currentGeneratedPages[pageId] = { ...currentGeneratedPages[pageId], content: newPageContent };
            }
          }
        }
      }

      setGeneratedPages(currentGeneratedPages);
      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: currentGeneratedPages,
          provider: "google",
          model: "local"
        })
      });
      setBrokenDiagrams([]);
      alert(`성공적으로 ${brokenDiagrams.length}개의 다이어그램 오류를 복구했습니다.`);
    } catch (e: any) {
      alert(`다이어그램 일괄 복구 실패: ${e.message}`);
    } finally {
      setIsBatchFixing(false);
    }
  };
"""
lines.insert(handleFix_end_idx, batch_fix_logic)

# 5. Update Markdown onFixDiagram usage
for i, line in enumerate(lines):
    if 'onFixDiagram={(chartCode) => handleFixDiagram(chartCode)}' in line or 'onFixDiagram={handleFixDiagram}' in line:
        lines[i] = '                      onFixDiagram={(chartCode, customPrompt) => handleFixDiagram(chartCode, customPrompt, selectedPage)}\n'

# 6. Add "Batch Fix" button to header
header_idx = -1
for i, line in enumerate(lines):
    if '<span>Settings</span>' in line:
        header_idx = i - 3
        break

if header_idx != -1:
    lines.insert(header_idx, """
            {brokenDiagrams.length > 0 && (
              <button
                onClick={handleFixAllDiagrams}
                disabled={isBatchFixing}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 8,
                  background: "var(--destructive, #ef4444)",
                  color: "white",
                  border: "none", cursor: isBatchFixing ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 500,
                  opacity: isBatchFixing ? 0.7 : 1
                }}
              >
                <RefreshCw size={14} className={isBatchFixing ? "animate-spin" : ""} />
                {isBatchFixing ? `오류 복구 중 (${batchFixProgress.current}/${batchFixProgress.total})...` : `일괄 오류 복구 (${brokenDiagrams.length})`}
              </button>
            )}
""")

with open('src/components/wiki-viewer.tsx', 'w') as f:
    f.writelines(lines)
