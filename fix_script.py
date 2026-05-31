import sys

with open('src/lib/wiki-generator.ts', 'r') as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    if 488 <= i <= 631: # 0-indexed, so lines 489 to 632
        pass
    else:
        new_lines.append(line)

replacement = """    await emitStep(streamId, 'phase_start', 'structure', `🧠 구조를 ${targetLanguage}로 번역 중...`);
    
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
      const match = structureContent.match(/\\{[\\s\\S]*\\}/);
      if (match) {
        // SSE 청크 안에 래핑되어 있을 경우를 대비하여 중첩 파싱 (또는 직접 파싱)
        let parsed = JSON.parse(match[0]);
        // OpenAI chunk format 인지 확인
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
             const innerMatch = parsed.choices[0].delta.content.match(/\\{[\\s\\S]*\\}/);
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
            const match = pageContent.match(/\\{[\\s\\S]*\\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                    finalContent = parsed.choices[0].delta.content;
                }
            }
        } catch(e) {}
        
        // Clean markdown wrapper
        finalContent = finalContent.replace(/^```(markdown|md)\\n/i, "").replace(/```$/i, "").trim();
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
"""

new_lines.insert(488, replacement)

with open('src/lib/wiki-generator.ts', 'w') as f:
    f.writelines(new_lines)
