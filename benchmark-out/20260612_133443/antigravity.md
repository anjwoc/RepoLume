# Module Documentation: `extHostDocumentData.test.perf-data.ts`

## Overview
The `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts` module is a dedicated performance testing utility file in the VS Code codebase. Its primary purpose is to provide a large, realistic dataset representing a language service response. Specifically, it exports a serialized TypeScript Server (`TSServer`) completion information response used to benchmark and verify the performance of the Extension Host's document and completion item data-handling pipelines.

---

## Module Contents & Responsibility

### Constants

#### `_$_$_expensive`
* **Type**: `string` (Serialized JSON)
* **Purpose**: Contains a mock response representing a TSServer `completionInfo` command output.
* **Structure**: The serialized JSON object simulates:
  * Protocol metadata (`seq`, `type`, `command`, `request_seq`, `success`).
  * A body payload including properties like `isGlobalCompletion`, `isMemberCompletion`, and a large list of `entries`.
  * Completion entries detailing:
    * `name`: The symbol or completion identifier (e.g., `__dirname`, `AbstractCodeEditorService`, etc.).
    * `kind`: The classification of completion (e.g., `class`, `method`, `var`, `function`).
    * `kindModifiers`: Modifiers such as `export`, `declare`, `abstract`, `private`.
    * `sortText`: Sorting weight for UI ranking.
    * `source`: The file system path where the completion item is defined.
    * `hasAction`: Indication of whether resolution actions are attached to the entry.

---

## Important Patterns & Design Decisions

### Isolation of Large Test Data
To prevent test suite logic from being cluttered with thousands of lines of static JSON structures, VS Code isolates mock data payloads into separate `.perf-data.ts` files. This keeps the test suite readable and maintains a clear separation of concerns.

### Real-world Sample Verification
The dataset represents actual captured data from a real VS Code development workspace (demonstrated by local path references like `/Users/jrieken/Code/vscode`). Benchmarking against real-world project signatures (as opposed to synthetic or simple arrays) ensures that performance evaluations reflect real-world scenarios, particularly around string allocation, parsing, and garbage collection.

---

## Integration in the Wider Project

### Consumer
This data is consumed by the extension host test suite, particularly `extHostDocumentData.test.ts` (or related ExtHost document and model benchmark suites), which tests the processing speed and memory utilization of document-related operations.

### Architectural Context
1. **Extension Host IPC**: The VS Code architecture relies on a distinct process model where extensions run on a separate Extension Host process. Large data lists, like auto-completion results, must be serialized, sent across IPC channels, and converted into API objects.
2. **Data Model Conversion**: The Extension Host must parse raw language server protocols (like TypeScript's TSServer protocol) and transform them into extension API-compliant objects (e.g., `vscode.CompletionItem`). Benchmarking with `_$_$_expensive` ensures that these data conversion pathways remain highly optimized and do not block the Extension Host.