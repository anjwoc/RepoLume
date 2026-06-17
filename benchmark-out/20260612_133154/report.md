# Benchmark Report — 20260612_133154

**Repo:** `/Users/jaecjeong/lab/vscode`  
**Module:** `extensions/vscode-colorize-perf-tests/test/colorize-fixtures/test-checker.ts`  
**Run at:** 20260612_133154

## Summary

| Provider | Status | Duration | Chars |
|----------|--------|----------|-------|
| gemini | ✅ OK | 71.5s | 8,627 |
| claude | ❌ ERROR | - | 0 |
| codex | ❌ ERROR | 20.5s | 0 |
| antigravity | ✅ OK | 17.9s | 3,365 |
| openrouter/deepseek-v4-flash | ⏭ SKIPPED | - | 0 |

## Output Previews

### gemini (✅ OK)
```markdown
I will use the `codegraph_explore` tool to understand the purpose of the `test-checker.ts` module, identify its key components, and determine how it integrates into the broader VS Code project, particularly within the colorization performance tests. This will allow me to generate a comprehensive Markdown wiki page as requested.
I apologize for the incorrect tool usage. I will now proceed with reading the file `extensions/vscode-colorize-perf-tests/test/colorize-fixtures/test-checker.ts` to gather the necessary information for the wiki page. I'll read the beginning of the file to understand its
...
```

### claude (❌ ERROR)
> ❌ [Errno 8] Exec format error: 'claude'

### codex (❌ ERROR)
> ❌ Reading prompt from stdin...
OpenAI Codex v0.137.0
--------
workdir: /Users/jaecjeong/lab/vscode
model: gpt-5.5-mini
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 019eba19-d6e8-7740-aa32-6a78cefe14ef
--------
user
/no_think

You are writing technical wiki documentation.

Module: `extensions/vscode-colorize-perf-tests/test/colorize-fixtures/test-checker.ts`

Source code:
```
// Copied from https://github.com/microsoft/TypeScript for running tests against a large file

import {
    __String,
    AccessExpression,
    AccessFlags,
    AccessorDeclaration,
    addRange,
    addRelatedInfo,
    addSyntheticLeadingComment,
    AliasDeclarationNode,
    AllAccessorDeclarations,
    AmbientModuleDeclaration,
    and,
    AnonymousType,
    AnyImportOrJsDocImport,
    AnyImportOrReExport,
    append,
    appendIfUnique,
    ArrayBindingPattern,
    arrayFrom,
    arrayIsHomogeneous,
    ArrayLiteralExpression,
    arrayOf,
    arraysEqual,
    arrayToMultiMap,
    ArrayTypeNode,
    ArrowFunction,
    AsExpression,
    AssertionExpression,
    AssignmentDeclarationKind,
    AssignmentKind,
    AssignmentPattern,
    AwaitExpression,
    BaseType,
    BigIntLiteral,
    BigIntLiteralType,
    BinaryExpression,
    BinaryOperator,
    BinaryOperatorToken,
    binarySearch,
    BindableObjectDefinePropertyCall,
    BindableStaticNameExpression,
    BindingElement,
    BindingElementGrandparent,
    BindingName,
    BindingPattern,
    bindSourceFile,
    Block,
    BooleanLiteral,
    BreakOrContinueStatement,
    CallChain,
    CallExpression,
    CallLikeExpression,
    CallSignatureDeclaration,
    CancellationToken,
    canHaveDecorators,
    canHaveExportModifier,
    canHaveFlowNode,
    canHaveIllegalDecorators,
    canHaveIllegalModifiers,
    canHaveJSDoc,
    canHaveLocals,
    canHaveModifiers,
    canHaveSymbol,
    canIncludeBindAndCheckDiagnostics,
    canUsePropertyAccess,
    cartesianProduct,
    CaseBlock,
    CaseClause,
    CaseOrDefaultClause,
    cast,
    chainDiagnosticMessages,
    CharacterCodes,
    CheckFlags,
    ClassDeclaration,
    ClassElement,
    classElementOrClassElementParameterIsDecorated,
    ClassExpression,
    ClassLikeDeclaration,
    classOrConstructorParameterIsDecorated,
    ClassStaticBlockDeclaration,
    clear,
    combinePaths,
    compareDiagnostics,
    comparePaths,
    compareValues,
    Comparison,
    CompilerOptions,
    ComputedPropertyName,
    concatenate,
    concatenateDiagnosticMessageChains,
    ConditionalExpression,
    ConditionalRoot,
    ConditionalType,
    ConditionalTypeNode,
    ConstructorDeclaration,
    ConstructorTypeNode,
    ConstructSignatureDeclaration,
    contains,
    containsParseError,
    ContextFlags,
    copyEntries,
    countWhere,
    createBinaryExpressionTrampoline,
    createCompilerDiagnostic,
    createDetachedDiagnostic,
    createDiagnosticCollection,
    createDiagnosticForFileFromMessageChain,
    createDiagnosticForNode,
    createDiagnosticForNodeArray,
    createDiagnosticForNodeArrayFromMessageChain,
    createDiagnosticForNodeFromMessageChain,
    createDiagnosticMessageChainFromDiagnostic,
    createEmptyExports,
    createEvaluator,
    createFileDiagnostic,
    createFlowNode,
    createGetSymbolWalker,
    createModeAwareCacheKey,
    createModuleNotFoundChain,
    createMultiMap,
    createNameResolver,
    createPrinterWithDefaults,
    createPrinterWithRemoveComments,
    createPrinterWithRemoveCommentsNeverAsciiEscape,
    createPrinterWithRemoveCommentsOmitTrailingSemicolon,
    createPropertyNameNodeForIdentifierOrLiteral,
    createScanner,
    createSymbolTable,
    createSyntacticTypeNodeBuilder,
    createTextWriter,
    Debug,
    Declaration,
    DeclarationName,
    declarationNameToString,
    DeclarationStatement,
    DeclarationWithTypeParameterChildren,
    DeclarationWithTypeParameters,
    Decorator,
    deduplicate,
    DefaultClause,
    defaultMaximumTruncationLength,
    DeferredTypeReference,
    DeleteExpression,
    Diagnostic,
    DiagnosticAndArguments,
    DiagnosticArguments,
    DiagnosticCategory,
    DiagnosticMessage,
    DiagnosticMessageChain,
    DiagnosticRelatedInformation,
    Diagnostics,
    DiagnosticWithLocation,
    DoStatement,
    DynamicNamedDeclaration,
    ElementAccessChain,
    ElementAccessExpression,
    ElementFlags,
    EmitFlags,
    EmitHint,
    emitModuleKindIsNonNodeESM,
    EmitResolver,
    EmitTextWriter,
    emptyArray,
    endsWith,
    EntityName,
    EntityNameExpression,
    EntityNameOrEntityNameExpression,
    entityNameToString,
    EnumDeclaration,
    EnumMember,
    EnumType,
    equateValues,
    escapeLeadingUnderscores,
    escapeString,
    EvaluatorResult,
    evaluatorResult,
    every,
    EvolvingArrayType,
    ExclamationToken,
    ExportAssignment,
    exportAssignmentIsAlias,
    ExportDeclaration,
    ExportSpecifier,
    Expression,
    expressionResultIsUnused,
    ExpressionStatement,
    ExpressionWithTypeArguments,
    Extension,
    ExternalEmitHelpers,
    externalHelpersModuleNameText,
    factory,
    fileExtensionIs,
    fileExtensionIsOneOf,
    filter,
    find,
    findAncestor,
    findBestPatternMatch,
    findConstructorDeclaration,
    findIndex,
    findLast,
    findLastIndex,
    findUseStrictPrologue,
    first,
    firstDefined,
    firstIterator,
    firstOrUndefined,
    firstOrUndefinedIterator,
    flatMap,
    flatten,
    FlowArrayMutation,
    FlowAssignment,
    FlowCall,
    FlowCondition,
    FlowFlags,
    FlowLabel,
    FlowNode,
    FlowReduceLabel,
    FlowStart,
    FlowSwitchClause,
    FlowSwitchClauseData,
    FlowType,
    forEach,
    forEachChild,
    forEachChildRecursively,
    forEachEnclosingBlockScopeContainer,
    forEachEntry,
    forEachKey,
    forEachReturnStatement,
    forEachYieldExpression,
    ForInOrOfStatement,
    ForInStatement,
    formatMessage,
    ForOfStatement,
    ForStatement,
    FreshableIntrinsicType,
    FreshableType,
    FreshObjectLiteralType,
    FunctionDeclaration,
    FunctionExpression,
    FunctionFlags,
    FunctionLikeDeclaration,
    FunctionOrConstructorTypeNode,
    FunctionTypeNode,
    GenericType,
    GetAccessorDeclaration,
    getAliasDeclarationFromName,
    getAllJSDocTags,
    getAllowSyntheticDefaultImports,
    getAncestor,
    getAssignedExpandoInitializer,
    getAssignmentDeclarationKind,
    getAssignmentDeclarationPropertyAccessKind,
    getAssignmentTargetKind,
    getCanonicalDiagnostic,
    getCheckFlags,
    getClassExtendsHeritageElement,
    getClassLikeDeclarationOfSymbol,
    getCombinedLocalAndExportSymbolFlags,
    getCombinedModifierFlags,
    getCombinedNodeFlags,
    getContainingClass,
    getContainingClassExcludingClassDecorators,
    getContainingClassStaticBlock,
    getContainingFunction,
    getContainingFunctionOrClassStaticBlock,
    getDeclarationModifierFlagsFromSymbol,
    getDeclarationOfKind,
    getDeclarationsOfKind,
    getDeclaredExpandoInitializer,
    getDecorators,
    getDirectoryPath,
    getEffectiveBaseTypeNode,
    getEffectiveConstraintOfTypeParameter,
    getEffectiveContainerForJSDocTemplateTag,
    getEffectiveImplementsTypeNodes,
    getEffectiveInitializer,
    getEffectiveJSDocHost,
    getEffectiveModifierFlags,
    getEffectiveReturnTypeNode,
    getEffectiveSetAccessorTypeAnnotationNode,
    getEffectiveTypeAnnotationNode,
    getEffectiveTypeParameterDeclarations,
    getElementOrPropertyAccessName,
    getEmitDeclarations,
    getEmitFlags,
    getEmitModuleKind,
    getEmitModuleResolutionKind,
    getEmitScriptTarget,
    getEmitStandardClassFields,
    getEnclosingBlockScopeContainer,
    getEnclosingContainer,
    getEntityNameFromTypeNode,
    getErrorSpanForNode,
    getEscapedTextOfIdentifierOrLiteral,
    getEscapedTextOfJsxAttributeName,
    getEscapedTextOfJsxNamespacedName,
    getESModuleInterop,
    getExpandoInitializer,
    getExportAssignmentExpression,
    getExternalModuleImportEqualsDeclarationExpression,
    getExternalModuleName,
    getExternalModuleRequireArgument,
    getFirstConstructorWithBody,
    getFirstIdentifier,
    getFunctionFlags,
    getHostSignatureFromJSDoc,
    getIdentifierGeneratedImportReference,
    getIdentifierTypeArguments,
    getImmediatelyInvokedFunctionExpression,
    getInitializerOfBinaryExpression,
    getInterfaceBaseTypeNodes,
    

[... truncated ...]
```

Write a comprehensive wiki page (Markdown) covering:
- What this module does and its purpose
- Key classes, functions, and their responsibilities
- Important patterns or design decisions
- How this module fits into the larger project

Output ONLY the Markdown content. No preamble, no explanation — just the wiki page.

ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}
ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}}

### antigravity (✅ OK)
```markdown
# VS Code Colorize Performance Test Fixture: `test-checker.ts`

The module `extensions/vscode-colorize-perf-tests/test/colorize-fixtures/test-checker.ts` is a specialized test fixture used within the Visual Studio Code codebase to measure and benchmark the performance of the editor's syntax colorization engine.

---

## Overview and Purpose

The primary purpose of `test-checker.ts` is to serve as a **large-scale, real-world stress test fixture** for syntax highlighting. 

It is a direct copy of a major part of the TypeScript compiler codebase (specifically the type checker module, `checker.ts`
...
```

### openrouter/deepseek-v4-flash (⏭ SKIPPED)
> OPENROUTER_API_KEY not set
