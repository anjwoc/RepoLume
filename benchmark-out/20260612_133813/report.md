# Benchmark Report — 20260612_133813

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts`  
**Run at:** 20260612_133813

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ✅ OK | 35.1s | 5,459 |
| claude | ⏭ SKIPPED | - | 0 |
| codex | ❌ ERROR | 8.5s | 0 |
| antigravity | ✅ OK | 14.7s | 4,590 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (✅ OK)
```markdown
` ` `markdown
# Module: `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts`

## Purpose

This module serves as a data fixture for performance tests related to the `extHostDocumentData` within Visual Studio Code's extension host process. Its primary purpose is to provide a realistic, yet static and controlled, dataset representing a complex IntelliSense completion information response. This allows for consistent and reproducible performance measurements without relying on live language service computations or external data sources during testing. The name `perf-data.ts` expl
...
```

### claude (⏭ SKIPPED)
> binary not executable (stub or wrong arch)

### codex (❌ ERROR)
> ❌ ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}

### antigravity (✅ OK)
```markdown
# Module: `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts`

This module provides mock performance data for testing document operations, completion providers, and editor-related API performance within the Extension Host (`extHost`) environment of Visual Studio Code.

---

## Overview and Purpose

The primary purpose of `extHostDocumentData.test.perf-data.ts` is to serve as a static repository of realistic, large-scale, and CPU-intensive completion item data. Instead of generating or fetching completion items dynamically during unit and performance tests, this module exp
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
