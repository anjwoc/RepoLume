```markdown
# Module: `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts`

## Purpose

This module serves as a data fixture for performance tests related to the `extHostDocumentData` within Visual Studio Code's extension host process. Its primary purpose is to provide a realistic, yet static and controlled, dataset representing a complex IntelliSense completion information response. This allows for consistent and reproducible performance measurements without relying on live language service computations or external data sources during testing. The name `perf-data.ts` explicitly indicates its role in performance testing.

## Key Structures and Responsibilities

The module exports a single constant:

### `_$_$_expensive`

This is a string literal containing a large, minified JSON object. This JSON object mimics the structure of a `completionInfo` response from a language service, which is typically returned when requesting code completion suggestions.

The internal structure of the JSON object includes:

-   `seq`: A sequence number for the response.
-   `type`: The type of message, which is "response".
-   `command`: The command associated with the response, "completionInfo".
-   `request_seq`: The sequence number of the original request.
-   `success`: A boolean indicating if the operation was successful.
-   `body`: The core payload of the completion information, containing:
    -   `isGlobalCompletion`: Boolean indicating if it's a global completion.
    -   `isMemberCompletion`: Boolean indicating if it's a member completion.
    -   `isNewIdentifierLocation`: Boolean indicating if it's a new identifier location.
    -   `entries`: An array of completion items. Each entry includes:
        -   `name`: The name of the symbol (e.g., `__dirname`, `_getInstrumentationKey`, `AbstractCaseAction`).
        -   `kind`: The kind of symbol (e.g., `var`, `method`, `class`, `module`, `function`).
        -   `kindModifiers`: Modifiers for the symbol kind (e.g., `declare`, `private`, `static`, `abstract`, `export`).
        -   `sortText`: Text used for sorting completion items.
        -   `hasAction`: Boolean indicating if there's an associated action.
        -   `source`: The file path where the symbol originates within the VS Code codebase (e.g., `/Users/jrieken/Code/vscode/node_modules/applicationinsights/out/Library/Config`, `/Users/jrieken/Code/vscode/src/vs/platform/instantiation/common/instantiation`).

The term `_$_$_expensive` in the constant name suggests that this particular data set is designed to represent a large or computationally "expensive" completion response, likely to thoroughly test the performance implications of processing such data.

## Important Patterns or Design Decisions

1.  **Static Data Fixture:** The use of a hardcoded string literal for the JSON data ensures that the performance tests always operate on the exact same input. This eliminates variability that might arise from dynamic data generation or live service calls, making performance benchmarks more reliable.
2.  **Realistic Payload:** The structure and content of the JSON closely mirror actual responses from TypeScript language services, including a wide variety of symbol kinds and source paths from different parts of the VS Code repository. This ensures that the performance tests are representative of real-world scenarios.
3.  **Performance Focus:** The module is specifically named `perf-data.ts` and the constant `_$_$_expensive`, highlighting its role in testing the performance of critical operations like parsing, processing, and rendering large completion lists.

## Integration within the Larger Project

This module is located in `src/vs/workbench/api/test/browser/extHostDocumentData.test.perf-data.ts`, which indicates:

-   It's part of the **`vs/workbench/api`** component, which handles the API surface exposed to VS Code extensions.
-   It relates to **`extHostDocumentData`**, suggesting it's concerned with how the extension host processes and manages document-related information.
-   It's within the **`test/browser`** directory, meaning it's used in browser-based tests (e.g., for web VS Code or general browser-compatible tests) rather than Node.js-specific tests.
-   The `perf-data` suffix signifies its explicit use in **performance tests**.

In the broader VS Code architecture, the extension host is a separate process responsible for running extensions. When an extension requests code completion, the extension host communicates with language services (which might be in a separate process or web worker) to get suggestions. The data provided by `_$_$_expensive` simulates the response from such a language service to the extension host. Performance tests using this data would likely measure:

-   How quickly the extension host can receive and process a large list of completion items.
-   The memory footprint associated with handling such data.
-   The time taken to serialize/deserialize this data across process boundaries (though here it's static, the parsing would still be measured).
-   The efficiency of any filtering, sorting, or rendering logic applied to these completion entries by the extension host or the main workbench.

This module is therefore a crucial piece of infrastructure for ensuring that the IntelliSense experience in VS Code remains fast and responsive, even with a large number of suggestions or complex language service responses.
```