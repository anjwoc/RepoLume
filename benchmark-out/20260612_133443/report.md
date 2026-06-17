# Benchmark Report — 20260612_133443

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts`  
**Run at:** 20260612_133443

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ✅ OK | 29.2s | 4,419 |
| claude | ❌ ERROR | - | 0 |
| codex | ❌ ERROR | 180.0s | 0 |
| antigravity | ✅ OK | 19.6s | 3,279 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (✅ OK)
```markdown
## `extHostDocumentData.test.perf-data.ts` Module Wiki

### Overview

The `extHostDocumentData.test.perf-data.ts` module serves as a data source for performance testing within the VS Code extension host environment, specifically related to `ExtHostDocumentData` and language service completions. It contains a pre-recorded, large JSON payload representing a comprehensive `completionInfo` response.

### Purpose

This module is crucial for:

1.  **Performance Benchmarking:** Providing a consistent, large dataset to measure the performance of the extension host's document processing and language se
...
```

### claude (❌ ERROR)
> ❌ [Errno 8] Exec format error: 'claude'

### codex (❌ ERROR)
> ❌ Timeout after 180s

### antigravity (✅ OK)
```markdown
# Module Documentation: `extHostDocumentData.test.perf-data.ts`

## Overview
The `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts` module is a dedicated performance testing utility file in the VS Code codebase. Its primary purpose is to provide a large, realistic dataset representing a language service response. Specifically, it exports a serialized TypeScript Server (`TSServer`) completion information response used to benchmark and verify the performance of the Extension Host's document and completion item data-handling pipelines.

---

## Module Contents & Responsibil
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
