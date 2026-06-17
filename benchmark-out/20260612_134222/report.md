# Benchmark Report — 20260612_134222

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts`  
**Run at:** 20260612_134222

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ✅ OK | 37.3s | 4,876 |
| claude | ⏭ SKIPPED | - | 0 |
| codex | ❌ ERROR | 7.7s | 0 |
| antigravity | ✅ OK | 13.5s | 3,910 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (✅ OK)
```markdown
# `pythonCookbookData.ts` Module Documentation

## Purpose

The `pythonCookbookData.ts` module acts as a structured data store within the VS Code Copilot extension. Its primary purpose is to provide "cookbook" examples and explanations for various Python code improvement rules, likely derived from linting tools such as Ruff. These data entries are used to generate contextual prompts or suggestions, helping users understand and apply best practices to their Python code. The module is explicitly marked as auto-generated, indicating it is compiled from another source and should not be edited manu
...
```

### claude (⏭ SKIPPED)
> binary not executable (stub or wrong arch)

### codex (❌ ERROR)
> ❌ ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}

### antigravity (✅ OK)
```markdown
# Python Inline Cookbooks Data Module

The module `extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts` is a static data provider within the VS Code Copilot extension. It holds structured documentation, explanations, and before/after code examples for Python linting rules and code style recommendations, primarily focusing on rules implemented by **Ruff** (a fast Python linter and formatter).

---

## Purpose and Functionality

The main purpose of this module is to supply the VS Code Copilot extension with quick-fix cookbooks and descriptions for specific Python diagnosti
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
