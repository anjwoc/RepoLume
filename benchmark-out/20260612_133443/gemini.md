## `extHostDocumentData.test.perf-data.ts` Module Wiki

### Overview

The `extHostDocumentData.test.perf-data.ts` module serves as a data source for performance testing within the VS Code extension host environment, specifically related to `ExtHostDocumentData` and language service completions. It contains a pre-recorded, large JSON payload representing a comprehensive `completionInfo` response.

### Purpose

This module is crucial for:

1.  **Performance Benchmarking:** Providing a consistent, large dataset to measure the performance of the extension host's document processing and language service integration when handling extensive completion lists.
2.  **Realistic Scenario Simulation:** Simulating a real-world scenario where a language server returns a significant number of completion items, allowing for profiling and optimization efforts without needing to spin up a full language server.
3.  **Regression Detection:** Ensuring that changes to `ExtHostDocumentData` handling or completion processing do not introduce performance regressions by running tests against this known, "expensive" data.

The naming convention `perf-data` clearly indicates its role in performance-related testing. The variable `_$_$_expensive` also hints at the data's size and computational cost during processing.

### Key Elements

The module's primary export is a constant named `_$_$_expensive`:

```typescript
export const _$_$_expensive = '{"seq":0,"type":"response","command":"completionInfo","request_seq":956,"success":true,"body":{"isGlobalCompletion":true,"isMemberCompletion":false,"isNewIdentifierLocation":false,"entries":[...]}}';
```

This string contains a minified JSON object with the following structure:

*   **`seq`**: A sequence number, typical in protocol messages.
*   **`type`**: Indicates the message type, here a "response".
*   **`command`**: Specifies the command that triggered this response, "completionInfo". This suggests it mimics a response from a language server protocol (LSP) `completion` request.
*   **`request_seq`**: The sequence number of the original request.
*   **`success`**: A boolean indicating if the operation was successful.
*   **`body`**: The core payload of the completion response, containing:
    *   **`isGlobalCompletion`, `isMemberCompletion`, `isNewIdentifierLocation`**: Booleans providing context about the completion request.
    *   **`entries`**: An array of individual completion items. Each entry includes:
        *   **`name`**: The text of the completion item (e.g., `__dirname`, `AbstractCaseAction`).
        *   **`kind`**: The type of symbol (e.g., `var`, `method`, `class`, `function`, `module`).
        *   **`kindModifiers`**: Additional modifiers for the symbol kind (e.g., `declare`, `private`, `static`, `export`, `abstract`).
        *   **`sortText`**: A string used by the client to sort the completion items.
        *   **`hasAction`**: A boolean indicating if the completion has an associated action.
        *   **`source`**: The file path from which the completion item originates (e.g., `/Users/jrieken/Code/vscode/src/vs/platform/instantiation/common/instantiation`). This is particularly useful for debugging resolution and import paths.

### Design Decisions

The decision to embed a large, static JSON string directly within a TypeScript file suggests:

*   **Isolation:** The test data is self-contained and doesn't rely on external files or services, making tests hermetic and reproducible.
*   **Performance Focus:** Loading a string constant is fast, and the performance measurement can then focus purely on parsing and processing the JSON content and the subsequent UI rendering/logic within the extension host.
*   **Readability (within JSON):** While the overall file contains a long string, the JSON structure itself is rich and detailed, allowing specific attributes of completion items to be tested.

### Integration with the Larger Project

This module is part of the `vs/workbench/api/test/browser` directory, indicating it's a browser-side test for the extension host API. It directly supports the testing infrastructure for VS Code extensions, particularly aspects related to how extensions interact with text documents and language features. It likely feeds into `ExtHostDocumentData` implementations to test how efficiently they can handle and present large amounts of data to the UI or other extension components.