# Wiki: CUDA C++ Syntax Highlighting Module

## Overview
The module `extensions/copilot/src/extension/completions-core/vscode-node/extension/src/panelShared/languages/cuda-cpp.tmLanguage.ts` provides a programmatic TextMate grammar definition for the **CUDA C++** language. 

It compiles the grammar rules into a structured TypeScript constant (`cudaCpp`) conforming to Shiki's `LanguageInput` interface, enabling syntax highlighting of CUDA code snippets inside shared webviews, panels, or completion preview areas within the VS Code Copilot extension.

---

## Key Configurations & Responsibilities

### 1. `cudaCpp` Constant (`LanguageInput`)
This is the primary export of the module. It configures the parser rules used by Shiki to tokenise CUDA C++ code.

* **Name**: `'CUDA C++'`
* **Scope Name**: `source.cuda-cpp`
* **Source Attribution**: Converted from the official [NVIDIA CUDA C++ Grammar repository](https://github.com/NVIDIA/cuda-cpp-grammar).

### 2. Grammar Patterns
The `patterns` array registers top-level syntax structures that the parser should evaluate, including:
* **Structural Constructs**: `class_block`, `struct_block`, `union_block`, `enum_block`, `namespace_block`, and `extern_block`.
* **Member/Method Constructs**: `constructor_root`, `destructor_root`, `function_definition`, and `operator_overload`.
* **Type Definitions**: `typedef_class`, `typedef_struct`, `typedef_union`, and `type_alias`.
* **CUDA/Low-level Constructs**: `assembly` (inline assembly instructions via `__asm__` or `asm`), `static_assert`, and `access_control_keywords`.

### 3. Repository Rules
The `repository` object defines re-usable, complex parser rules using regular expressions. Important token scopes defined here include:
* **`access_control_keywords`**: Matches access specifiers (`public`, `private`, `protected`) along with support for inner inline comments.
* **`alignas_attribute` / `alignas_operator` / `alignof_operator`**: Captures alignment attributes and operators and associates them with standard C++ styling scopes (e.g. `support.other.attribute.cuda-cpp`).
* **`assembly`**: Matches assembly statements (`__asm__`, `asm`) along with their modifiers (`volatile`).

---

## Important Patterns & Design Decisions

* **Upstream Synchronization**: The file is derivative of NVIDIA's master grammar definition (specifically tracking commit `81e88eaec5170aa8585736c63627c73e3589998c`). Bug fixes or language additions are intended to be submitted upstream first rather than patched ad-hoc in this file.
* **Complex Capture Groups**: Rules employ nested capture groups and include references back to standard contexts (like `#ever_present_context`, `#inline_comment`, and `#evaluation_context`) to correctly tokenize hybrid host/device C++ code without sacrificing performance.
* **TypeScript Compilation**: By converting the original JSON grammar definition into a TypeScript module, the syntax definitions can be statically imported and bundler-optimized, avoiding dynamic filesystem reads during extension runtime.

---

## Integration in the Project
This file fits into the syntax-highlighting engine of the Copilot extension's completion rendering pipeline:

```
+-------------------------------------------------+
| NVIDIA CUDA C++ Grammar (.json)                 |
+-----------------------+-------------------------+
                        | (Converted to TS)
                        v
+-------------------------------------------------+
| cuda-cpp.tmLanguage.ts (Exporting LanguageInput)|  <-- This Module
+-----------------------+-------------------------+
                        | (Loaded by Shiki)
                        v
+-------------------------------------------------+
| Copilot Panel / Shared Webviews / UI Components |
| (Syntax highlights CUDA C++ completion code)    |
+-------------------------------------------------+
```

When users request completions or view suggestions for CUDA C++ code, the Copilot panel handles visual presentation. Shiki loads this module as a custom language input configuration to guarantee accurate token styling consistent with native C++ editor settings.