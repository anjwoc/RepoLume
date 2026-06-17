# Benchmark Report — 20260612_134104

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `extensions/copilot/src/extension/completions-core/vscode-node/extension/src/panelShared/languages/cuda-cpp.tmLanguage.ts`  
**Run at:** 20260612_134104

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ✅ OK | 31.2s | 5,156 |
| claude | ⏭ SKIPPED | - | 0 |
| codex | ❌ ERROR | 7.7s | 0 |
| antigravity | ✅ OK | 14.8s | 4,130 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (✅ OK)
```markdown
## `cuda-cpp.tmLanguage.ts` - CUDA C++ TextMate Grammar

### Module Overview

The `cuda-cpp.tmLanguage.ts` module defines the TextMate grammar for CUDA C++ within the VS Code environment. Its primary purpose is to enable accurate syntax highlighting, code folding, and other language-specific features for CUDA C++ source files, enhancing the development experience for users working with NVIDIA's CUDA platform.

This file is part of the `extensions/copilot` directory, suggesting its role in supporting language features potentially consumed or leveraged by the Copilot extension, or more broadly, 
...
```

### claude (⏭ SKIPPED)
> binary not executable (stub or wrong arch)

### codex (❌ ERROR)
> ❌ ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}

### antigravity (✅ OK)
```markdown
# Wiki: CUDA C++ Syntax Highlighting Module

## Overview
The module `extensions/copilot/src/extension/completions-core/vscode-node/extension/src/panelShared/languages/cuda-cpp.tmLanguage.ts` provides a programmatic TextMate grammar definition for the **CUDA C++** language. 

It compiles the grammar rules into a structured TypeScript constant (`cudaCpp`) conforming to Shiki's `LanguageInput` interface, enabling syntax highlighting of CUDA code snippets inside shared webviews, panels, or completion preview areas within the VS Code Copilot extension.

---

## Key Configurations & Responsibilities
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
