import { emitTaskEvent, fetchContent } from "./taskStreamClient";
import mermaid from 'mermaid';
import { normalizeMarkdownContent } from "./markdown-normalize";
import { loadCatalog, findFlow } from './flow-catalog';
import { buildFlowPrompt } from './build-flow-prompt';
import type { McpInstance } from './mcp-instance-registry';
import path from 'path';
import fs from 'fs';

// ─── Project Classification ────────────────────────────────────────────────
// Detected once per generation run (Phase 1.5) using file-tree + README
// heuristics. Zero LLM calls. Drives section hints and per-page requirements.

type ProjectType =
  | 'ide'           // VS Code, Eclipse plugin, Neovim plugin
  | 'backend-api'   // REST/GraphQL server (FastAPI, Spring, Express…)
  | 'frontend-web'  // React/Vue/Next.js web app
  | 'fullstack'     // frontend + backend in one repo
  | 'cli-tool'      // command-line tool (Commander, Cobra, Click…)
  | 'library-sdk'      // reusable library / SDK / npm package
  | 'compiler'         // compiler, bundler, AST transformer
  | 'monorepo'         // Turborepo / Nx / Lerna multi-package repo
  | 'multi-project'    // directory containing 2+ independent sub-projects (MSA, polyrepo, multi-module)
  | 'mobile'           // iOS / Android / React Native
  | 'data-platform'    // data pipelines, dbt, Airflow, Spark
  | 'general';         // fallback

function classifyProject(fileTree: string, readme: string): ProjectType {
  const text = `${fileTree}\n${readme}`.toLowerCase();
  const has = (...ps: string[]) => ps.some(p => text.includes(p));

  // IDE — VS Code internals, extension host, workbench
  if (has('src/vs/', '/workbench/', 'extensionhost', 'extension host',
          'contribution point', 'language-features/', 'textmate', '/code/node/'))
    return 'ide';

  // Multi-project — root directory contains 2+ independent sub-projects each with their own build config.
  // Rationale: if the user pointed to THIS directory and it has multiple independent projects inside,
  // those projects are organically related (they're siblings for a reason). Treat as a system.
  // Detects: pom.xml, build.gradle, go.mod, Cargo.toml, package.json at depth-1 sub-dirs.
  const mpMatches = text.match(/\b([\w-]+)\/(pom\.xml|build\.gradle|go\.mod|cargo\.toml)/gi) || [];
  const mpServiceDirs = new Set(mpMatches.map(p => p.split('/')[0].toLowerCase()));
  if (mpServiceDirs.size >= 2) return 'multi-project';

  // Monorepo — unambiguous config files
  if (has('turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml',
          'rush.json', 'bolt.json'))
    return 'monorepo';

  // Mobile — platform-specific directories
  if (has('android/', 'ios/', 'react-native', 'expo ', 'viewcontroller',
          'appdelegate', 'xcworkspace'))
    return 'mobile';

  // Compiler / dev tool — AST-centric code
  if (has('/ast/', 'ast.ts', 'ast.js', 'astnode', 'tokenize', 'tokenizer',
          'lexer.ts', 'lexer.js', 'parser.ts', 'parser.js', 'codegeneration',
          'code generation', 'bytecode', 'ir builder', '.ll\n', 'llvm'))
    return 'compiler';

  // Data platform — pipeline-specific files
  if (has('dbt_project.yml', 'airflow', 'pyspark', 'dagster', 'prefect',
          'data pipeline', '.dbt/', 'warehouse', 'dbt_packages', 'apache spark'))
    return 'data-platform';

  // Frontend / Backend / Fullstack
  const isFrontend = has('react', 'vue ', 'angular', 'svelte', 'next.config',
                         'components/', 'pages/', 'tailwind', 'remix');
  const isBackend = has('fastapi', 'flask', 'express', 'nestjs', 'spring boot',
                        'django', 'routes/', 'migrations/', 'models.py',
                        'serializer', 'controller.ts', 'controller.java',
                        'repository.ts', 'repository.java');
  if (isFrontend && isBackend) return 'fullstack';
  if (isFrontend) return 'frontend-web';
  if (isBackend) return 'backend-api';

  // CLI tool
  if (has('"bin":', 'bin/:', 'commander', 'yargs', 'click.command',
          'argparse', 'cobra.command', 'clap::command'))
    return 'cli-tool';

  // Library / SDK
  if (has('"main":', '"exports":', 'peerDependencies', 'npm publish',
          'src/index.ts\n', 'src/index.js\n', 'lib/index'))
    return 'library-sdk';

  return 'general';
}

/** Human-readable Korean label for display in the progress log. */
function projectTypeLabel(type: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    ide:            'IDE / 에디터',
    'backend-api':  '백엔드 API',
    'frontend-web': '프론트엔드 웹앱',
    fullstack:      '풀스택',
    'cli-tool':     'CLI 도구',
    'library-sdk':  '라이브러리 / SDK',
    compiler:       '컴파일러 / 빌드도구',
    monorepo:          '모노레포',
    'multi-project':   '멀티 프로젝트 시스템',
    mobile:            '모바일 앱',
    'data-platform':'데이터 플랫폼',
    general:        '일반 소프트웨어',
  };
  return labels[type] ?? '일반 소프트웨어';
}

/**
 * Project-type-aware mandatory section templates for the ToC generation prompt.
 * Each type lists required sections with decomposition rules. These sections
 * are treated as MANDATORY (not suggestions) in the Phase 2b prompt.
 */
function projectTypeHints(type: ProjectType): string {
  const hints: Record<ProjectType, string> = {

    // ─── IDE / Code Editor ────────────────────────────────────────────────────
    ide: `
### PROJECT TYPE: IDE / Code Editor — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (17):
1. Architecture Overview — Repository Structure, Build System, Core Architectural Layers
2. Getting Started — Development Environment setup, building from source, debugging the editor itself
3. Electron Main Process — Application Lifecycle, Window Management, Native Shell Integration
4. CLI and Environment Services — CLI commands, environment detection, process spawning
5. Workbench UI Framework — Layout and Parts System, Editor Groups, Views/Panels/Activity Bar
6. Theming, Icons, and Styling — Color themes, file icons, custom CSS/fonts
7. Settings, Keybindings, and Configuration — Settings schema, keybinding resolution, profiles
8. Monaco Editor Core — Text Model, View Model, Editor Rendering and Input Handling
9. Language Features and LSP — Completion, diagnostics, go-to-definition, LSP protocol
10. Inline Completions and Ghost Text — Ghost text rendering, inline completion providers
11. Extension System — Extension Host Architecture, IPC Protocol, VS Code Extension API, Marketplace, Webview
12. Terminal — Architecture and Process Management, Shell Integration, Terminal Contributions
13. AI and Copilot Features — Chat Service, Chat Editing, Inline Chat, MCP Integration, Agent Host
14. Source Control and Git — SCM Framework, Git Extension, diff editor
15. Debugging — Debug Adapter Protocol, Session Lifecycle, Debug Configuration
16. Remote Development and Tunnels — Remote Extension Host Server, CLI Tunnel Client
17. Platform Services and Testing Infrastructure — File System, Auth, User Data Sync, Accessibility, Test Framework

DECOMPOSITION RULES:
- Each section MUST have at least 3 focused pages (never one catch-all page per section).
- Monaco Editor Core → 4+ pages: Text Model, View Model, Rendering, Language Features.
- Extension System → 4+ pages: Host Architecture, VS Code API, Marketplace, Webview.
- AI/Copilot section → 3+ pages per major AI feature (Chat, Inline, MCP, Agents).
- If this repo has project-specific AI or agent features, add them as extra pages under AI section.`,

    // ─── Backend API ──────────────────────────────────────────────────────────
    'backend-api': `
### PROJECT TYPE: Backend API — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (13):
1. Getting Started — local run, env vars, seed data, Docker compose
2. Architecture Overview — request lifecycle, layer diagram, DI container, module structure
3. API Reference — REST/GraphQL endpoints grouped by domain (one page per major domain/resource)
4. Authentication and Authorization — token types, auth middleware, RBAC/ABAC, guards/decorators
5. Domain Models and Database Schema — entity definitions, relationships, ER diagram, migrations
6. Service Layer — business logic patterns, inter-service calls, domain events
7. Data Access Layer — repository pattern, ORM queries, transactions, connection pooling
8. Validation and Error Handling — DTOs, pipes, exception filters, error response format
9. Background Jobs and Event System — queue setup, job handlers, event bus, retry/DLQ
10. Caching and Performance — cache layers, invalidation strategy, query optimization, N+1
11. Observability — structured logging, metrics, distributed tracing, health checks
12. Testing Strategy and Deployment — unit/integration/E2E patterns, CI/CD, infrastructure
13. Business Flows — ONE PAGE PER major end-to-end business flow: trace entry point → service → repository → DB. Each page MUST include a mermaid sequenceDiagram with DB tables as participants, per-step SQL (SELECT/INSERT/UPDATE) with actual column names and values, and a component chain completeness table with file:line references.

DECOMPOSITION RULES:
- API Reference: one page per major API domain (e.g., Auth API, Users API, Orders API). NEVER one flat page.
- Domain Models: entity pages grouped by aggregate root, not one flat "models" page.
- If the project has multiple services or microservices, each service gets its own Architecture page.`,

    // ─── Frontend Web App ─────────────────────────────────────────────────────
    'frontend-web': `
### PROJECT TYPE: Frontend Web Application — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (12):
1. Getting Started — dev server setup, env vars, build commands, local proxy config
2. Application Architecture — routing strategy, page structure, layout system, rendering mode (CSR/SSR/SSG)
3. Component System — component hierarchy, design tokens, compound patterns, prop contracts
4. State Management — global store architecture, local state patterns, derived state, selectors
5. Data Fetching and API Integration — HTTP client setup, query library config, caching, optimistic updates
6. Authentication Flow — login/logout/refresh, protected routes, token storage, auth context
7. Forms and Validation — form library setup, validation schemas, error display, submit handling
8. Styling and Design System — CSS strategy, theme system, responsive breakpoints, dark mode
9. Performance Optimization — code splitting, lazy loading, bundle analysis, Core Web Vitals
10. Build System and Tooling — bundler config, env handling, path aliases, CI build pipeline
11. Testing Strategy — unit (component), integration, E2E patterns, MSW/fixture setup
12. Business Flows — ONE PAGE PER major user-facing flow that touches a backend or BFF: trace UI action → API call → server-side DB write. Each page MUST include a mermaid sequenceDiagram showing the UI→API→DB path, per-step SQL where applicable, and a component chain completeness table.

DECOMPOSITION RULES:
- Component System: separate pages for atomic components, composite components, and layout components.
- State Management: separate pages for store setup, async state, and optimistic updates.
- If the project has a design system library (Storybook, etc.), it gets its own pages.`,

    // ─── Fullstack Application ────────────────────────────────────────────────
    fullstack: `
### PROJECT TYPE: Fullstack Application — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (15):
1. Getting Started — running frontend + backend simultaneously, env setup, dev tunnels/proxy
2. System Architecture — monorepo vs polyrepo structure, frontend-backend communication (REST/GraphQL/tRPC/WS)
3. Backend: API Design and Reference — endpoint design, versioning, request/response contracts
4. Backend: Domain Models and Database — entities, schema, migrations, ORM/query patterns
5. Backend: Service and Business Logic — service layer, DI, domain events, inter-service calls
6. Backend: Authentication and Authorization — session/JWT/OAuth flow, backend guards
7. Frontend: Application Architecture — routing, page structure, rendering strategy
8. Frontend: Component System and State — component hierarchy, global state, data fetching
9. Authentication Flow (End-to-End) — login UI → token → protected API route → session lifecycle
10. Real-time Features — WebSocket/SSE setup, event contracts, reconnection handling (if applicable)
11. Type Sharing and API Contracts — shared types, code generation (tRPC/OpenAPI/GraphQL codegen)
12. Database Schema and Migrations — full schema diagram, migration strategy, seeding
13. Testing Strategy — frontend unit, backend unit, integration, E2E (Playwright/Cypress)
14. Build, Deployment, and Infrastructure — Docker, CI/CD pipeline, environment promotion
15. Business Flows — ONE PAGE PER major end-to-end business flow spanning frontend and backend: trace user action → API → service → DB. Each page MUST include a mermaid sequenceDiagram with DB tables as participants, per-step SQL with actual column names, and a component chain completeness table with file:line references.

DECOMPOSITION RULES:
- Backend and Frontend sections MUST be separate — never merge "Backend API + Frontend" into one section.
- Authentication: a dedicated end-to-end flow page, plus separate backend auth and frontend auth pages.
- If the project uses tRPC or GraphQL, add a dedicated "Type-Safe API Layer" section.`,

    // ─── CLI Tool ─────────────────────────────────────────────────────────────
    'cli-tool': `
### PROJECT TYPE: CLI Tool — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (10):
1. Getting Started and Installation — npm/brew/binary install, PATH setup, first command
2. Command Reference — SEPARATE PAGE per major command group (e.g., "init commands", "deploy commands")
3. Configuration System — config file format, precedence order, env var overrides, schema
4. Core Architecture — command parsing pipeline, context passing, middleware, error boundaries
5. Plugin and Extension System — plugin API, hook points, lifecycle, publishing (if applicable)
6. Shell Integration — autocomplete setup (bash/zsh/fish), man pages, shell functions
7. Authentication and Credentials — login flow, token storage, multi-account, keychain
8. Scripting and Automation — non-interactive mode, JSON/machine-readable output, piping, CI usage
9. Exit Codes and Error Messages — exit code table, error format, debugging flags, verbose mode
10. Testing and Distribution — test patterns, binary build, release pipeline, cross-platform

DECOMPOSITION RULES:
- Command Reference MUST have one page per logical command group — never one flat "all commands" page.
- If the CLI has subcommands (like git's porcelain), each subcommand family gets its own page.
- Configuration section: separate pages for file format spec and for precedence/env docs.`,

    // ─── Library / SDK ────────────────────────────────────────────────────────
    'library-sdk': `
### PROJECT TYPE: Library / SDK — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (12):
1. Getting Started and Installation — install, first working example, TypeScript setup
2. Core Concepts and Mental Model — key abstractions, design philosophy, how pieces fit together
3. API Reference: Core Module — SEPARATE PAGE per major class/function group (primary API surface)
4. API Reference: Advanced APIs — secondary APIs, low-level hooks, utility exports
5. Configuration and Options — all config keys, types, defaults, environment-specific behavior
6. Common Patterns and Recipes — top 10 use cases with code samples, real-world examples
7. Framework Integrations — React/Vue/Angular/Node adapters, one page per major framework
8. Error Handling and Debugging — error types, error codes, debugging tips, common mistakes
9. Performance and Memory — complexity notes, large-data patterns, memory management
10. Migration and Versioning — semver policy, breaking change history, migration guides per major version
11. Contributing and Internals — repo structure, how to run tests, architecture of the library itself
12. Business Flows — ONE PAGE PER major SDK workflow that involves DB or persistent state: trace caller API → internal processing → DB read/write. Each page MUST include a mermaid sequenceDiagram with DB as participant, per-step SQL with actual column names, and a component chain completeness table.

DECOMPOSITION RULES:
- API Reference MUST be split by module/class — never one massive "API" page.
- Each major framework integration (React, Vue, etc.) gets its own page.
- Migration guide: one page per major version bump (e.g., v1→v2, v2→v3).`,

    // ─── Compiler / Build Tool ────────────────────────────────────────────────
    compiler: `
### PROJECT TYPE: Compiler / Build Tool / Transformer — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (12):
1. Getting Started — run the compiler on a sample project, basic config, output walkthrough
2. Architecture Overview — full pipeline diagram (source → output), stage dependencies, data flow
3. Lexer and Tokenizer — token types, scanning rules, unicode handling, error recovery
4. Parser and AST — grammar rules, AST node hierarchy, parse error recovery, concrete vs abstract
5. Semantic Analysis — symbol tables, scope resolution, type inference, binding passes
6. Type System (if applicable) — type representation, subtyping, generics, type checking algorithms
7. Transformation Passes — each pass: purpose, input/output AST shape, ordering constraints
8. Code Generation and Emit — target format, optimization levels, source maps, tree-shaking
9. Incremental Compilation and Caching — file watch, change detection, build cache invalidation
10. Plugin and Hook System — plugin API, hook types, transform hooks, loader interface
11. Error Reporting and Diagnostics — error/warning format, source locations, fix suggestions
12. Testing Strategy and Benchmarks — test corpus, snapshot testing, performance regression tests

DECOMPOSITION RULES:
- Each compilation stage MUST be a separate section — never "Parsing and Semantic Analysis" merged.
- Transformation Passes: if there are 5+ distinct passes, each major pass gets its own page.
- If the tool supports multiple output targets (e.g., ESM, CJS, WASM), each target gets coverage.`,

    // ─── Multi-Project System (MSA / Polyrepo / Multi-module) ────────────────
    // Triggered when the analyzed root dir contains 2+ sub-projects each with
    // their own build config. The sub-projects are siblings for a reason —
    // they form an organic system and must be analyzed both individually AND
    // in terms of how they communicate and share data.
    'multi-project': `
### PROJECT TYPE: Multi-Project System — MANDATORY SECTION TEMPLATE
The analyzed directory contains multiple independent sub-projects that form a cohesive system.
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (minimum = 3 cross-cutting + 1 per detected sub-project):
1. System Overview — full service/component map, network topology, shared infrastructure, deployment architecture
2. Business Flows — ONE PAGE PER major end-to-end business flow: trace user requests across projects (HTTP + events + DB writes). Each page MUST include: (1) mermaid sequenceDiagram with DB tables as named participants, (2) per-step SQL (SELECT/INSERT/UPDATE/EXEC) with actual column names and enum values, (3) component chain completeness table with file:line references and ✅/🔧/❌ status per component.
3. [Sub-Project Name] (one rootSection PER detected sub-project — NEVER merge two projects):
   - API Contract: endpoints/interfaces this project exposes, who calls it (inbound), what it calls (outbound)
   - Domain Model: core entities, aggregate roots, DB schema/tables owned by this project
   - Internal Architecture: project layers, key business logic, events published/consumed
4. Communication & Integration Backbone — how projects talk to each other: HTTP clients, event bus topics, shared schemas, message contracts
5. Cross-Cutting Concerns — auth propagation across projects, distributed tracing/log correlation, error handling, shared config

DECOMPOSITION RULES:
- EVERY detected sub-project becomes its own rootSection with minimum 3 pages. NEVER merge two sub-projects.
- System Overview MUST include Mermaid graph TD: all sub-project nodes + HTTP arrows + event/queue arrows + external DB/cache nodes.
- Business Flows: include sequenceDiagram per flow. Each arrow must show the HTTP method+endpoint OR event topic name.
- API Contract page for each sub-project MUST document: inbound callers (which other projects call this one) AND outbound calls (which projects/services this one calls).
- Communication Backbone: include a producer-consumer table if events/queues are used: Topic | Producer Project | Consumer Projects | Schema summary.
- NEVER create a flat "All APIs" page covering all sub-projects — each sub-project API is its own page.`,

    // ─── Monorepo ─────────────────────────────────────────────────────────────
    monorepo: `
### PROJECT TYPE: Monorepo — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (12):
1. Getting Started — clone, install (pnpm/yarn/npm workspaces), bootstrap all packages, first build
2. Repository Structure and Package Map — what each package does, dependency graph visualization
3. Build System and Task Orchestration — Turborepo/Nx/Bazel: task graph, caching, remote cache
4. Shared Packages and Internal Libraries — how packages depend on each other, import patterns
5. Application Packages — one page per major app (web app, mobile app, CLI, server) with its own setup
6. Adding and Scaffolding Packages — step-by-step guide, generator tools, naming conventions
7. Dependency Management — version pinning strategy, internal vs external deps, patch management
8. CI/CD Strategy — affected detection, pipeline per package vs root pipeline, deployment topology
9. Testing Across Packages — cross-package test setup, shared fixtures, integration test patterns
10. Code Generation and Tooling — codegen scripts, workspace scripts, linting/formatting at scale
11. Publishing and Versioning — changesets/semantic-release, release workflow, npm publish
12. Business Flows — ONE PAGE PER major cross-package end-to-end flow: trace the request through packages to the DB. Each page MUST include a mermaid sequenceDiagram with DB tables as participants, per-step SQL with actual column names, and a component chain completeness table showing which package owns each step.

DECOMPOSITION RULES:
- Application Packages: SEPARATE PAGE per major app in the monorepo.
- If there are 5+ shared packages, give each significant one its own page.
- CI/CD: separate pages for build pipeline and deployment pipeline.`,

    // ─── Mobile App ───────────────────────────────────────────────────────────
    mobile: `
### PROJECT TYPE: Mobile Application — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (13):
1. Getting Started — simulator/emulator setup, device build, signing profiles, first launch
2. Architecture Overview — overall app architecture (MVC/MVVM/Clean), module boundaries
3. Navigation Architecture — stack/tab/drawer setup, deep linking, navigation state persistence
4. State Management and Data Flow — global state, local state, async state, reactive patterns
5. Networking and API Integration — HTTP client, request/response interceptors, offline handling
6. Authentication and Security — login flow, token storage (keychain/keystore), biometrics
7. UI Components and Design System — custom component library, theming, accessibility
8. Native Module Bridges — custom native modules, JSI/TurboModules, platform-specific code
9. Push Notifications — setup (APNs/FCM), deep link routing, notification permissions
10. Background Processing — background fetch, silent push, app state transitions
11. Build, Signing, and Release — Fastlane/Xcode/Gradle config, App Store / Play Store pipeline
12. Testing Strategy — unit (Jest), component (RTL), E2E (Detox/Maestro), device testing
13. Business Flows — ONE PAGE PER major app flow that involves a backend: trace UI gesture → API call → server DB write. Each page MUST include a mermaid sequenceDiagram (mobile screen → API → service → DB), per-step SQL where applicable, and a component chain completeness table.

DECOMPOSITION RULES:
- Authentication: separate pages for auth flow, token refresh, and biometric/keychain storage.
- Navigation: separate pages for stack configuration and deep link routing.
- If this is a React Native project, include separate pages for iOS-specific and Android-specific behaviors.`,

    // ─── Data Platform ────────────────────────────────────────────────────────
    'data-platform': `
### PROJECT TYPE: Data Platform / Analytics — MANDATORY SECTION TEMPLATE
Each area below MUST become its own rootSection. DO NOT merge or omit any.

REQUIRED SECTIONS (13):
1. Getting Started — local environment, sample data, running your first pipeline
2. Architecture Overview — full data flow diagram, zones (raw/staging/mart), technology stack
3. Data Sources and Ingestion — connectors, CDC, batch vs streaming, schema evolution
4. Data Models and Transformations — DBT models (or Spark/SQL), layer organization (staging/intermediate/mart)
5. Orchestration and Scheduling — DAG structure (Airflow/Prefect/Dagster), task dependencies, SLA
6. Stream Processing (if applicable) — Kafka/Flink/Spark Streaming, windowing, exactly-once semantics
7. Data Warehouse and Storage — warehouse schema, partitioning, clustering, storage formats (Parquet/Delta/Iceberg)
8. Data Quality and Validation — test framework (dbt-test/Great Expectations), anomaly detection, SLAs
9. Monitoring and Lineage — data lineage graph, pipeline alerting, dataset freshness
10. Query Interface and APIs — BI tool connections, semantic layer, query API, access control
11. Infrastructure and Scaling — compute resources, autoscaling, cost management, environment promotion
12. Contributing: Adding New Pipelines — step-by-step guide, naming conventions, test requirements
13. Business Flows — ONE PAGE PER major data pipeline flow: trace source ingestion → transformation → storage → output. Each page MUST include a mermaid sequenceDiagram with storage tables/buckets as participants, per-step SQL/DML with actual table and column names, and a pipeline stage completeness table.

DECOMPOSITION RULES:
- Data Models: separate pages per layer (staging models, intermediate, final mart models).
- Orchestration: separate pages for DAG authoring patterns and for scheduling/SLA configuration.
- If the platform has both batch and streaming, each gets its own section.`,

    // ─── General ─────────────────────────────────────────────────────────────
    general: `
### PROJECT TYPE: General Software
Analyze the actual codebase and generate sections that reflect the real structure.

REQUIRED SECTIONS (minimum 6, add more based on what you find):
1. Getting Started — setup, prerequisites, first run
2. Architecture Overview — system diagram, key components, data flow
3. Core Features and Modules — one page per significant feature area or module
4. API and Interfaces — public API, interfaces, extension points (if applicable)
5. Testing Strategy — how tests are organized, how to run them
6. Deployment and Operations — build, deploy, configuration

DECOMPOSITION RULES:
- Examine the actual directory structure to find additional domain-specific sections.
- Each major subdirectory with meaningful code deserves consideration as its own section.
- If the project has a well-defined domain model, give it a dedicated section.`,
  };

  return hints[type] ?? hints.general;
}

/**
 * Project-type-aware topic requirements — called alongside `topicRequirements()`
 * in page generation. Returns mandatory diagram/table requirements specific to
 * this project type + page topic combination.
 */
function projectTypeTopicRequirements(type: ProjectType, sectionTitle: string, pageTitle: string): string {
  const text = `${sectionTitle} ${pageTitle}`.toLowerCase();
  const has = (...ks: string[]) => ks.some(k => text.includes(k));

  if (type === 'ide') {
    if (has('extension', 'plugin', 'contribution', '확장'))
      return `
### IDE 확장 시스템 필수 요구사항
- 확장 활성화 라이프사이클 \`sequenceDiagram\` 포함 (host 시작 → manifest 읽기 → activation event → API 호출).
- Contribution points 테이블 포함: Point / 타입 / 스키마 / 예시.
- 익스텐션 호스트와 렌더러의 샌드박스 경계 설명 (허용 API, IPC 메커니즘).`;
    if (has('language', 'lsp', 'languageserver', 'completion', 'diagnostic', 'hover', '언어'))
      return `
### IDE 언어 기능 / LSP 필수 요구사항
- 주요 LSP 흐름 \`sequenceDiagram\` 포함 (예: textDocument/completion): Editor → LSP client → Language Server → response → UI.
- 기능 테이블 포함: Feature / LSP Method / Provider Interface / Default Handler.
- 언어 기능 provider 등록 패턴 설명.`;
    if (has('process', 'ipc', 'host', 'render', 'electron', 'worker', '프로세스'))
      return `
### IDE 프로세스 아키텍처 필수 요구사항
- 모든 프로세스(main, renderer, extension host, worker, shared process)와 IPC 채널을 보여주는 \`graph LR\` 포함.
- 통신 테이블: From → To / Channel / Message 예시.
- 각 프로세스에서 무엇이 실행되는지와 그 이유(보안 모델, 성능 격리) 설명.`;
    if (has('workbench', 'ui', 'layout', 'panel', 'sidebar', 'activity', '워크벤치'))
      return `
### IDE 워크벤치 / UI 셸 필수 요구사항
- 워크벤치 레이아웃 컴포지션을 보여주는 \`graph TD\` 포함 (shell → parts → views → widgets).
- 서비스 테이블: Service / Location / Injected-As / Purpose.
- 워크벤치 셸의 contribution 기반 확장성 모델 설명.`;
    if (has('debug', 'dap', 'breakpoint', '디버그'))
      return `
### IDE 디버그 어댑터 프로토콜 필수 요구사항
- DAP 통신 흐름 \`sequenceDiagram\` 포함 (Editor UI → Debug Adapter → Runtime → response).
- DAP 요청/이벤트 테이블: Method / Direction / Key Fields / Trigger.
- 새 디버그 어댑터 연동 방법 설명.`;
  }

  if (type === 'compiler') {
    if (has('ast', 'node', 'syntax', 'tree', 'visit'))
      return `
### 컴파일러 AST 필수 요구사항
- AST 노드 계층을 보여주는 \`graph TD\` 포함 (주요 노드 타입과 부모-자식 관계).
- 노드 타입 테이블: Node Kind / Interface / 주요 Properties / 소스 예시 → AST.
- AST 순회/방문 방법 설명 (visitor 패턴, each-child).`;
    if (has('pipeline', 'stage', 'phase', 'pass', 'transform', '파이프라인'))
      return `
### 컴파일러 파이프라인 필수 요구사항
- 각 스테이지 경계에서 입출력 타입을 표시한 \`graph LR\` 포함.
- 스테이지 테이블: Stage / Entry Point / 입력 타입 / 출력 타입 / 주요 파일.
- 각 스테이지에서 확립되는 불변식과 포착 가능한 오류 명시.`;
  }

  if (type === 'monorepo') {
    if (has('package', 'workspace', 'dependency', 'graph', '패키지'))
      return `
### 모노레포 패키지 구조 필수 요구사항
- 패키지 간 의존 관계를 보여주는 \`graph LR\` 포함 (어떤 패키지가 어떤 패키지를 import하는지).
- 패키지 테이블: Package / Path / 목적 / Consumers.
- 내부 import 컨벤션 설명 (workspace: 프로토콜, tsconfig paths 등).`;
  }

  if (type === 'multi-project') {
    if (has('system overview', 'service map', 'system map', '시스템 개요', '서비스 맵', '전체'))
      return `
### 멀티 프로젝트 시스템 개요 필수 요구사항
- 전체 서브 프로젝트 연결 \`graph TD\` 필수: 각 프로젝트 노드, HTTP 호출 화살표(endpoint 표기), 이벤트/메시지 화살표(topic 표기), 외부 DB/캐시 노드.
- 프로젝트 책임 테이블: Project / Domain / Tech Stack / DB Owned / Port / Key Dependencies.
- 외부 시스템 목록: 3rd party APIs, message brokers, CDN, auth server 등.`;

    if (has('business flow', '비즈니스 플로우', '플로우', 'flow', 'journey', '흐름'))
      return `
### 멀티 프로젝트 비즈니스 플로우 필수 요구사항
- 각 플로우마다 \`sequenceDiagram\` 필수: Client → ProjectA → ProjectB → DB → EventBus → ProjectC 순서로.
- 각 화살표에 HTTP method+endpoint 또는 event topic명 명시.
- 실패 경로(error response, dead-letter, timeout, fallback) 별도 표시.
- 플로우가 여러 개면 페이지를 분리 — 하나의 페이지에 모든 플로우를 우겨넣지 말 것.`;

    if (has('api contract', 'api 계약', 'endpoint', 'interface', '인터페이스', '계약'))
      return `
### 멀티 프로젝트 API Contract 필수 요구사항
- 엔드포인트 테이블: Method / Path / Request Body / Response / Auth Required / 호출 주체.
- Inbound 호출자 테이블: 이 프로젝트를 호출하는 다른 프로젝트 + 어떤 엔드포인트 + 어떤 HTTP 클라이언트 클래스.
- Outbound 호출 테이블: 이 프로젝트가 호출하는 다른 프로젝트/외부 서비스 + 사용하는 HTTP 클라이언트.`;

    if (has('event', 'messaging', '이벤트', 'kafka', 'rabbit', 'queue', 'topic', 'message', '메시지'))
      return `
### 멀티 프로젝트 이벤트 / 메시징 필수 요구사항
- Producer-Consumer Matrix 테이블 필수: Topic / Producer Project / Consumer Projects / Message Schema 요약 / 발행 트리거.
- 각 이벤트의 발행 조건(언제 publish되는지) 명시.
- Dead-letter / retry / 순서 보장 정책 테이블.`;

    if (has('domain model', 'domain', 'entity', '도메인', '엔티티', 'schema', 'table', '테이블'))
      return `
### 멀티 프로젝트 도메인 모델 필수 요구사항
- 이 프로젝트가 소유한 테이블/엔티티 ER 다이어그램.
- 다른 프로젝트의 데이터를 참조하는 경우: 어떤 ID를 foreign key처럼 사용하는지, 동기화 방식(API 호출 vs 이벤트) 명시.
- 데이터 소유권 명확화: 어떤 프로젝트가 이 데이터의 source of truth인지.`;
  }

  if (type === 'data-platform') {
    if (has('pipeline', 'dag', 'flow', 'ingestion', '파이프라인'))
      return `
### 데이터 파이프라인 필수 요구사항
- 전체 데이터 흐름을 보여주는 \`graph LR\` 포함 (Source → Ingest → Transform → Load → Serve).
- DAG/파이프라인 테이블: Name / Schedule / Source → Target / SLA.
- 실패 처리 및 재실행 전략 설명.`;
  }

  return '';
}

// ─── Topic-specific page requirements (generic, type-agnostic) ────────────
// Topic-specific page requirements. The generic prompt only *suggests* diagrams,
// so the model defaults to `graph TD` and never emits sequence/ER diagrams. These
// blocks MANDATE the diagram type + concrete content per topic. Routed by keywords
// in the section title + page title (Korean and English).
function topicRequirements(sectionTitle: string, pageTitle: string): string {
  const text = `${sectionTitle} ${pageTitle}`.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => text.includes(k));
  if (has('database', 'schema', 'data model', 'datamodel', 'erd', 'entity', 'persistence', 'table', '데이터', '스키마', '테이블', '엔티티'))
    return `
### MANDATORY for this DATA MODEL / DATABASE page
- Include an \`erDiagram\` of the tables/entities with primary keys, foreign keys, and relationship cardinality (e.g. \`CUSTOMER ||--o{ ORDER : places\`), extracted from the JPA entities / schema in the source files.
- Include per-table column tables: column / type / constraints / description.
- Add a paragraph explaining the main joins and relationships. Base everything strictly on the source files — do NOT invent.`;
  if (has('batch', 'scheduler', 'cron', 'job', '배치'))
    return `
### MANDATORY for this BATCH JOB page
- Include a \`sequenceDiagram\` of the job execution order (Scheduler/Trigger → JobLauncher → Step → ItemReader → ItemProcessor → ItemWriter → commit), making chunk boundaries and the transaction commit point explicit.
- Include a table of the job's schedule/tuning: job name / cron or trigger / chunk-size / idempotency / retry & skip policy.
- Add a dedicated paragraph on failure & re-run behavior.`;
  if (has('event', 'consumer', 'producer', 'kafka', 'message', 'stream', 'queue', 'topic', '이벤트', '메시지'))
    return `
### MANDATORY for this EVENT-PROCESSING page
- Include a \`sequenceDiagram\` of the message flow (Producer → Broker/topic → Consumer group → Handler → ack/commit) with the retry / DLQ branch on failure shown explicitly.
- Include a table of topics/messages: topic / payload schema / consumer group / partition key.
- Add a dedicated paragraph on idempotency, duplicate handling, and dead-letter (DLQ) policy.`;
  if (has('api', 'backend', 'controller', 'service', 'gateway', 'endpoint', '백엔드'))
    return `
### MANDATORY for this BACKEND API page
- Include an endpoint table: HTTP method / path / auth / request & response summary.
- Include a \`sequenceDiagram\` for at least one key endpoint (Client → Controller → Service → Repository/external call → Response).
- Add a dedicated paragraph on the authentication & authorization flow.`;
  if (has('architect', 'overview', 'system design', 'architecture', '아키텍처', '시스템', '개요', '구성'))
    return `
### MANDATORY for this ARCHITECTURE/OVERVIEW page
- Include a \`graph LR\` or \`graph TD\` diagram showing the main components and how they interconnect.
- Include a module responsibility table: Module/Directory / Location / Responsibility.
- Trace a representative request or operation end-to-end: entry point → processing → output. Cite the actual files involved.`;
  if (has('frontend', 'ui component', 'view', 'render', '프론트', '화면', '컴포넌트'))
    return `
### MANDATORY for this FRONTEND/UI page
- Include a component hierarchy diagram (\`graph TD\`) showing parent-child relationships for the key components.
- Include a component table: Component / File Path / Purpose / Key Props or State.
- Explain how state flows through the component tree and what triggers re-renders.`;
  if (has('test', 'spec', 'e2e', 'unit test', 'integration test', '테스트'))
    return `
### MANDATORY for this TESTING page
- Include a diagram (\`graph TD\`) showing the test categories and what each covers.
- Include a test-type table: Type / Location / Tools / Coverage scope.
- Explain how to run each test category locally and what CI enforces.`;
  if (has('extension', 'plugin', 'module', 'extensi', '확장', '플러그인', '모듈'))
    return `
### MANDATORY for this EXTENSION/MODULE page
- Include a \`graph LR\` diagram showing the extension lifecycle (registration → activation → execution → deactivation).
- Include a public API table: API / Type / Description / Example.
- Explain how extensions are discovered, loaded, and communicate with the host.`;
  if (has('getting started', 'quick start', 'installation', 'setup', 'onboarding', '시작', '설치', '온보딩'))
    return `
### MANDATORY for this GETTING STARTED page
- Include a step-by-step numbered setup sequence — every command must be exact and copy-pasteable.
- Include a prerequisites table: Tool / Minimum Version / Installation Link.
- End with a "verify your setup" section showing the expected output of a test command.`;
  if (has('business flow', 'business flows', 'flow analysis', 'flow detail', '비즈니스 플로우', '플로우 분석'))
    return `
### MANDATORY for this BUSINESS FLOW page
- Include a \`sequenceDiagram\` with DB tables as named participants (e.g. \`participant DB_Req as "Oracle: LINKREW_MESSAGE_REQUEST"\`). Every arrow must show the real method name or SQL operation.
- Include a **DB-Level Data Flow** section with:
  - Full table map: \`| Table | DB | Role |\`
  - Per-step SQL: [STEP 1]…[STEP N], each with real SELECT/INSERT/UPDATE/EXEC, actual column names, WHERE clause values, and enum constants ('N'/'Y', etc.)
  - JPA methods annotated as: \`-- JPA: methodName(param)\`
  - Unverifiable SQL: \`-- NOTE: MCP not connected — manual verification required\`
  - Processing order summary line per step: \`[Oracle] TABLE ← INSERT (COL='VAL')\`
  - Text ERD showing table relationships for this flow
- Include a **Component Chain Completeness** table: \`| # | Component | file:line | Status (✅/🔧/❌) |\`
- DO NOT include: local dev environment issues, service startup order, Docker/k8s, deployment/CI details.`;
  return '';
}

// Temporary fixed default until the per-wiki language setting is properly wired.
// While set, all generation/regeneration/fix output uses this language regardless
// of the (possibly stale) per-wiki language tag. Set to null to restore honoring
// each wiki's own language. Centralized here so the choice lives in ONE place.
export const FORCED_WIKI_LANGUAGE: string | null = "ko";

/** Resolve the effective language: the forced default if set, else the wiki's own. */
export function effectiveWikiLanguage(language?: string): string {
  return FORCED_WIKI_LANGUAGE ?? language ?? "ko";
}

/** Single source of truth for the language instruction. Default is Korean-base
 *  with English technical terms; only an explicit "en" yields English-only. */
export function wikiLanguageInstruction(language?: string): string {
  const lang = effectiveWikiLanguage(language);
  if (lang === "en") {
    return "IMPORTANT: The wiki content MUST be written ENTIRELY in English. Do NOT include Korean translations.";
  }
  if (lang === "bilingual") {
    return "IMPORTANT: The wiki content MUST be generated bilingually (Korean with English technical terms preserved and explained).";
  }
  return "IMPORTANT: The main explanations and natural language descriptions MUST be written in Korean (한국어). However, you MUST KEEP essential technical terms, system components, variable names, and core section headers (e.g., Overview, Introduction, Deployment) in English.";
}

const STRICT_FORMAT_RULES = `
### CRITICAL OUTPUT FORMAT RULES
1. Output ONLY the raw generated content (Markdown or JSON depending on the task).
2. DO NOT include any conversational text, pleasantries, intro, or outro (e.g. "Here is the wiki page...", "Based on your prompt...").
3. DO NOT repeat, leak, or mention the prompt instructions, system messages, or these rules in your output.
4. Your response must begin immediately with the actual content.
`;


/** 프로바이더 이름 → CLI 에이전트 이름 매핑 */
function providerToCli(provider: string): string {
  if (provider === "google") return "gemini";
  if (provider === "anthropic") return "claude";
  return "codex"; // openai 및 기타
}

/** 경과 시간을 ms 단위로 반환 */
function elapsed(startMs: number): number {
  return Date.now() - startMs;
}

/** 단계별 emit 헬퍼 */
async function emitStep(
  streamId: string,
  type: string,
  phase: string,
  message: string,
  data?: Record<string, unknown>
) {
  await emitTaskEvent(streamId, { type, phase, message, data });
}

function _genId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function _collectLeafIds(node: any): string[] {
  if (!node.children?.length) return [node.name || node.id || _genId()];
  return node.children.flatMap((c: any) => _collectLeafIds(c));
}

function _flattenItemsToPages(items: any[]): any[] {
  const pages: any[] = [];
  const visit = (node: any) => {
    if (node.children?.length) {
      node.children.forEach((c: any) => visit(c));
    } else {
      pages.push({
        id: node.name || node.id || _genId(),
        title: node.title || node.name || "Untitled",
        content: "",
        filePaths: [],
        importance: "medium",
        relatedPages: [],
      });
    }
  };
  items.forEach(item => visit(item));
  return pages;
}

function _buildSectionsFromItems(items: any[]): any[] {
  return items.map((item: any) => ({
    id: item.name || item.id || _genId(),
    title: item.title || item.name || "Section",
    pages: _collectLeafIds(item),
  }));
}

/** Convert any id string to kebab-case. Handles snake_case, camelCase, PascalCase. */
function _toKebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')   // camelCase → camel-Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2') // XMLParser → XML-Parser
    .replace(/[_\s]+/g, '-')                // snake_case / spaces → hyphens
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalize all id fields in the wiki structure to kebab-case in-place. */
function _normalizeStructureIds(structure: any): void {
  const idMap = new Map<string, string>(); // oldId → newId

  // Collect and remap page ids
  for (const page of structure.pages ?? []) {
    const newId = _toKebab(page.id);
    if (newId !== page.id) idMap.set(page.id, newId);
    page.id = newId;
  }

  // Remap section ids and their page references
  for (const sec of structure.sections ?? []) {
    const newId = _toKebab(sec.id);
    if (newId !== sec.id) idMap.set(sec.id, newId);
    sec.id = newId;
    sec.pages = (sec.pages ?? []).map((pid: string) => idMap.get(pid) ?? _toKebab(pid));
    sec.subsections = (sec.subsections ?? []).map((sid: string) => idMap.get(sid) ?? _toKebab(sid));
  }

  // Remap rootSections
  structure.rootSections = (structure.rootSections ?? []).map(
    (sid: string) => idMap.get(sid) ?? _toKebab(sid)
  );
}

// ─── Directory Map Extraction ─────────────────────────────────────────────────

function autoFixMermaid(code: string): string {
  return code
    // Wrap node labels containing parentheses: [Text (info)] → ["Text (info)"]
    .replace(/\[([^\]"]*\([^)]*\)[^\]"]*)\]/g, '["$1"]')
    // Wrap node labels containing brackets: [Text [sub]] → ["Text [sub]"]
    .replace(/\[([^\]"]*\[[^\]]*\][^\]"]*)\]/g, '["$1"]')
    // Fix edge labels with double quotes: -->|"label"| → -->|label|
    .replace(/-->(\|)"([^"]+)"\|/g, '-->|$2|')
    // Remove literal \n in labels (LLM sometimes inserts these)
    .replace(/\\n/g, ' ');
}

function extractDirectoryMap(fileTree: string, maxEntries = 80): string {
  const lines = fileTree.split('\n').filter(Boolean);

  // Build full directory tree: parentPath → Set<childDirName>
  // We track dirs only (skip filenames = last segment without extension or last segment overall)
  const tree = new Map<string, Set<string>>();

  for (const line of lines) {
    const cleaned = line.replace(/^[│├└─\s]+/, '').trim().replace(/\/$/, '');
    if (!cleaned || cleaned.startsWith('...') || cleaned.startsWith('#')) continue;
    const parts = cleaned.split('/').filter(Boolean);
    // All segments except the last are directories; the last may be file or dir
    const dirDepth = parts.length - 1; // conservative: treat last as file
    for (let d = 0; d < dirDepth && d < 5; d++) {
      const parent = d === 0 ? '.' : parts.slice(0, d).join('/');
      if (!tree.has(parent)) tree.set(parent, new Set());
      tree.get(parent)!.add(parts[d]);
    }
  }

  // Unwrap single-child funnels: if a dir has exactly 1 child, descend until branching
  // e.g. src/ → vs/ → {workbench, editor, platform, ...} renders as "src/vs/ → workbench/, ..."
  function resolveDir(path: string, depth: number): Array<{ path: string; children: Set<string> }> {
    const children = tree.get(path) ?? new Set();
    if (children.size === 0) return [];
    // If single-child funnel AND not too deep, unwrap
    if (children.size === 1 && depth < 8) {
      const only = [...children][0];
      const childPath = path === '.' ? only : `${path}/${only}`;
      return resolveDir(childPath, depth + 1);
    }
    return [{ path, children }];
  }

  const roots = tree.get('.') ?? new Set();
  const entries: Array<{ path: string; children: Set<string> }> = [];

  for (const root of [...roots].sort()) {
    const resolved = resolveDir(root, 1);
    entries.push(...resolved);
    // Also expand one level deeper for dirs with many children
    for (const { path, children } of resolved) {
      if (children.size >= 4) {
        for (const child of [...children].sort().slice(0, 10)) {
          const childPath = path === '.' ? child : `${path}/${child}`;
          const grandchildren = tree.get(childPath) ?? new Set();
          if (grandchildren.size >= 3) {
            entries.push({ path: childPath, children: grandchildren });
          }
        }
      }
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const { path, children } of entries) {
    if (seen.has(path) || result.length >= maxEntries) break;
    seen.add(path);
    const display = path === '.' ? '(root)' : `${path}/`;
    const childList = [...children].sort().slice(0, 14);
    const ellipsis = children.size > 14 ? ', ...' : '';
    result.push(`${display} → ${childList.join('/, ')}/${ellipsis}`);
  }
  return result.join('\n');
}

// ─── Wiki Structure Result ────────────────────────────────────────────────────

export interface WikiStructureResult {
  wikiStructure: any;
  pageCount: number;
  sectionCount: number;
  projectType: ProjectType;
  actualFileCount: number;
  file_tree: string;
  readme: string;
  subsystems: Array<{ id: string; name: string; paths: string[]; description: string }>;
  graphifyArchSummary?: string;
}

// ─── Phase 1 + 2a + 2b: Structure Generation ─────────────────────────────────

export async function runWikiStructure(
  projectPath: string,
  streamId: string,
  outputLanguage: string = "ko",
  testMode: boolean = false,
  provider: string = "google",
  model: string = "gemini-2.5-flash",
  apiKey?: string,
  mode: "cli" | "api" = "cli",
  cliTool?: string,
  pipelineFlags?: { mcp?: boolean; concurrency?: number },
  userFeedback?: string,
  previousStructure?: any,
): Promise<WikiStructureResult> {
  const rawName = projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  const repo = rawName
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "")
    || "project";
  const repo_type = "local";
  const language = outputLanguage;
  const languageInstruction = wikiLanguageInstruction(language);

  // ── Phase 1: 파일 스캔 ────────────────────────────────────────────────────
  const t1 = Date.now();
  await emitStep(streamId, 'phase_start', 'scan', '📂 프로젝트 파일 스캔 시작...');

  let file_tree = '';
  let fullTreeForDirMap = '';
  let readme = '';
  let actualFileCount = 0;
  try {
    const resStructure = await fetch(`/local_repo/structure?path=${encodeURIComponent(projectPath)}`);
    if (!resStructure.ok) {
      const errText = await resStructure.text().catch(() => '(응답 없음)');
      throw new Error(`파일 스캔 실패 (HTTP ${resStructure.status}): ${errText}`);
    }
    const structData = await resStructure.json();
    file_tree = structData.file_tree || '';
    readme = structData.readme || '';
    const fileCount = file_tree.split('\n').filter(Boolean).length;
    actualFileCount = fileCount;

    // directoryMap은 truncation 전 전체 트리에서 추출 — 대형 프로젝트(VSCode 등)에서
    // 800줄 제한 이후에 추출하면 src/vs/ 만 보이고 workbench/, editor/ 등이 누락됨
    fullTreeForDirMap = file_tree;

    const FILE_TREE_MAX_LINES = 800;
    const README_MAX_CHARS = 3000;
    const treeLines = file_tree.split('\n');
    if (treeLines.length > FILE_TREE_MAX_LINES) {
      file_tree = treeLines.slice(0, FILE_TREE_MAX_LINES).join('\n')
        + `\n... (${treeLines.length - FILE_TREE_MAX_LINES} more files truncated)`;
    }
    if (readme.length > README_MAX_CHARS) {
      readme = readme.slice(0, README_MAX_CHARS) + '\n... (truncated)';
    }
    await emitStep(streamId, 'phase_complete', 'scan',
      `✅ 파일 스캔 완료 — ${fileCount}개 파일 발견 (${elapsed(t1)}ms)`,
      { file_count: fileCount, elapsed_ms: elapsed(t1) }
    );
  } catch (err) {
    await emitStep(streamId, 'error', 'scan',
      `❌ 파일 스캔 실패: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  // ── Phase 1.5: 프로젝트 유형 분류 ────────────────────────────────────────
  const projectType = classifyProject(fullTreeForDirMap || file_tree, readme);
  await emitStep(streamId, 'agent_log', 'scan',
    `🔍 프로젝트 유형 감지: ${projectTypeLabel(projectType)} (${projectType})`
  );

  // ── Phase 1.6: Graphify + CodeGraph 사전 인덱싱 (동기 완료) ───────────────
  // 인덱스가 없을 때만 실행. 두 인덱서를 병렬로 완료한 뒤 Phase 2로 진행 —
  // 모든 하위 Phase가 첫 실행부터 최고 품질 컨텍스트를 사용할 수 있음.
  try {
    await fetch('/api/code/ensure-indices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_path: projectPath, stream_id: streamId }),
    });
  } catch {
    // 인덱싱 실패는 치명적이지 않음 — Phase 2 이후 fallback으로 진행
  }

  // ── Phase 2: AI 구조 생성 ─────────────────────────────────────────────────
  const t2 = Date.now();
  await emitStep(streamId, 'phase_start', 'structure', '🧠 AI 위키 구조 분석 중...');


  // ── LLM 헬퍼 (2a, 2b 공통) ───────────────────────────────────────────────
  const buildBody = (content: string) => ({
    repo_url: projectPath,
    type: repo_type,
    stream_id: streamId,
    messages: [{ role: 'user', content }],
    model,
    provider,
    language,
    skip_rag: true,
    is_wiki_generation: true,
    ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
  });

  const streamLLM = async (content: string): Promise<string> => {
    const out = await fetchContent('/api/chat/stream', buildBody(content));
    if (out.includes("CLI Error:")) throw new Error(out.split("CLI Error:").pop()!.trim());
    return out;
  };

  const extractJson = (text: string, preferArray = false): any | null => {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1] : text;
    if (preferArray) {
      const fi = body.indexOf('['), li = body.lastIndexOf(']');
      if (fi !== -1 && li > fi) {
        try { return JSON.parse(body.slice(fi, li + 1)); } catch {}
      }
    }
    const fi = body.indexOf('{'), li = body.lastIndexOf('}');
    if (fi === -1 || li <= fi) return null;
    try { return JSON.parse(body.slice(fi, li + 1)); } catch { return null; }
  };

  // ── Phase 2a: 아키텍처 서브시스템 발견 ──────────────────────────────────
  // general을 제외한 모든 타입은 projectTypeHints에 이미 충분한 섹션 구조가 있으므로
  // Phase 2a를 skip한다. Phase 2a를 실행하면 LLM이 4~6개 고수준 버킷만 반환해
  // Phase 2b에서 type hints의 세분화된 섹션 구조를 override하는 문제가 생긴다.
  const SKIP_PHASE2A_TYPES: ProjectType[] = [
    'ide', 'compiler', 'backend-api', 'frontend-web', 'fullstack',
    'monorepo', 'mobile', 'data-platform', 'library-sdk', 'cli-tool',
  ];
  const directoryMap = extractDirectoryMap(fullTreeForDirMap, projectType === 'multi-project' ? 300 : 80);

  // Graphify 아키텍처 요약 fetch — Phase 2b ToC와 Phase 4.5 인사이트에서 재사용
  let graphifyArchSummary = '';
  try {
    const archRes = await fetch('/api/graph/architecture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_path: projectPath }),
    });
    if (archRes.ok) {
      const archData = await archRes.json();
      if (archData.summary) {
        graphifyArchSummary = archData.summary;
        await emitStep(streamId, 'agent_log', 'structure',
          `✅ Graphify 아키텍처 요약 로드 완료 (${graphifyArchSummary.length}자) — ToC 품질 향상`);
      }
    }
  } catch { /* Graphify 없으면 directoryMap fallback */ }

  // For multi-project: extract top-level sub-project dirs from flat file paths before Phase 2a
  let topLevelServiceDirs = '';
  if (projectType === 'multi-project') {
    const buildFilePat = /^([\w-]+)\/(pom\.xml|build\.gradle|go\.mod|cargo\.toml)$/i;
    const serviceDirMap = new Map<string, string>();
    for (const line of fullTreeForDirMap.split('\n')) {
      const m = line.trim().match(buildFilePat);
      if (m) serviceDirMap.set(m[1], m[2]);
    }
    if (serviceDirMap.size >= 2) {
      topLevelServiceDirs = `\n### Detected top-level sub-projects (each directory has its own build config — treat each as an INDEPENDENT sub-project):\n${
        [...serviceDirMap.entries()].map(([dir, f]) => `- ${dir}/ (${f})`).join('\n')
      }\n`;
    }
  }

  let subsystems: Array<{ id: string; name: string; paths: string[]; description: string }> = [];

  if (SKIP_PHASE2A_TYPES.includes(projectType)) {
    await emitStep(streamId, 'agent_log', 'structure',
      `✅ ${projectTypeLabel(projectType)} 타입: 사전 정의 섹션 구조 사용 (Phase 2a skip)`);
  } else {
    await emitStep(streamId, 'agent_log', 'structure', '🔍 아키텍처 서브시스템 분석 중...');
    try {
      const subsystemPrompt = projectType === 'multi-project'
        ? `You are analyzing a multi-project system where the analyzed root directory contains multiple independent sub-projects that form an organic, related system.
${topLevelServiceDirs}
Directory structure (package-level detail):
<directory_map>
${directoryMap}
</directory_map>

README:
<readme>
${readme.slice(0, 2000)}
</readme>

For EACH top-level sub-project directory listed above, identify:
- What business domain / responsibility it owns
- What APIs or interfaces it exposes (REST controllers, gRPC services, public interfaces)
- What other sub-projects or external services it calls (HTTP clients: RestTemplate, WebClient, FeignClient, Feign, fetch, axios)
- What events/messages it publishes (KafkaTemplate, RabbitTemplate, EventPublisher, message queues)
- What events/messages it consumes (@KafkaListener, @RabbitListener, @EventListener, message consumers)
- What database / storage it owns

Return a JSON ARRAY — ONE entry per top-level sub-project listed above (every directory must have an entry):
[
  {
    "id": "kebab-case-project-id",
    "name": "Project Human Name",
    "paths": ["project-dir/"],
    "description": "Domain: <what it does>. Exposes: <APIs>. Calls: <other projects/services>. Publishes: <event topics>. Consumes: <event topics>."
  }
]
Rules:
- EVERY sub-project directory listed in "Detected top-level sub-projects" above MUST have exactly one entry
- description MUST capture inter-project communication (HTTP calls, events) — this is the most important part
- id must be kebab-case (use the directory name as the base, e.g. "affiliate-admin" → "affiliate-admin")`
        : `You are analyzing a ${projectTypeLabel(projectType)} codebase.

Directory structure:
<directory_map>
${directoryMap}
</directory_map>

README:
<readme>
${readme.slice(0, 2000)}
</readme>

Identify the MAJOR architectural subsystems or layers in this codebase.
Return a JSON ARRAY ONLY — no prose, no markdown fences, no other text:
[
  { "id": "kebab-case-id", "name": "Human Readable Name", "paths": ["src/path/"], "description": "one-sentence description" }
]
Rules:
- 8 to 20 subsystems
- Each subsystem maps to real directories in the directory map above
- No overlapping subsystems
- Use actual directory names from the map
- id must be kebab-case (e.g. "extension-host", "chat-sessions", "cli-tunnels")`;

      const subsysRaw = await streamLLM(subsystemPrompt);
      const parsed = extractJson(subsysRaw, true);
      const minSubsystems = projectType === 'multi-project' ? 2 : 4;
      if (Array.isArray(parsed) && parsed.length >= minSubsystems) {
        subsystems = parsed.filter((s: any) => s.id && s.name);
        await emitStep(streamId, 'agent_log', 'structure',
          `✅ 서브시스템 ${subsystems.length}개 식별: ${subsystems.map(s => s.name).join(', ')}`);
      }
    } catch (e) {
      await emitStep(streamId, 'agent_log', 'structure',
        `⚠️ 서브시스템 분석 실패, 단일 패스로 계속: ${e}`);
    }
  }

  // ── Phase 2b: 상세 ToC 생성 ──────────────────────────────────────────────
  // subsystems가 있을 때만 "MUST become sections" 지시를 추가.
  // ide/compiler는 subsystems=[] 이므로 projectTypeHints가 유일한 섹션 지시가 됨.
  const subsystemSection = subsystems.length > 0
    ? (projectType === 'multi-project'
      ? `\n### MANDATORY: Multi-Project rootSection Structure
This system has ${subsystems.length} independent sub-projects. The JSON MUST use this exact rootSections layout:

rootSections MUST include ALL of the following (in this order):
  1. "system-overview" — title: "System Overview", pages: service-map (graph TD), business-flow (sequenceDiagram), data-flow
${subsystems.map((s, i) => `  ${i + 2}. "${s.id}" — title: "${s.name}", pages: ${s.id}-api (API Contract), ${s.id}-domain (Domain Model), ${s.id}-architecture (Internal Architecture)`).join('\n')}
  ${subsystems.length + 2}. "cross-cutting" — title: "Cross-Cutting Concerns", pages: auth, observability, error-handling

HARD CONSTRAINTS — violation = wrong output:
- rootSections array MUST contain: "system-overview", ${subsystems.map(s => `"${s.id}"`).join(', ')}, "cross-cutting"
- Each sub-project is its OWN rootSection — NEVER group them inside a "Deep Dive" or "Services" parent
- Minimum ${subsystems.length * 3 + 5} total pages
- Sub-project descriptions for context:
${subsystems.map(s => `  ${s.name}: ${s.description}`).join('\n')}
`
      : `\n### Identified Architectural Subsystems (MUST become sections)\n${
          subsystems.map(s => `- ${s.name}: ${s.description}`).join('\n')
        }\n\nDECOMPOSITION RULES (MANDATORY):\n1. Each subsystem above becomes its own SECTION in rootSections.\n2. Within each section, create separate pages for distinct sub-components (core data structures, key algorithms, public API/extension points, integration points).\n3. NEVER merge two distinct subsystems into one section.\n4. NEVER create a single "Overview" page that covers multiple subsystems — split it.\n`)
    : '';

  const feedbackSection = userFeedback
    ? `\n### 사용자 피드백 (필수 반영)\n${userFeedback}\n\n이전 구조를 기반으로 위 피드백을 반영해 개선하세요:\n<previous_structure>\n${
        JSON.stringify(previousStructure ?? {}, null, 2).slice(0, 3000)
      }\n</previous_structure>\n`
    : '';

  // 모든 타입: directory map을 프롬프트에 포함해 LLM이 섹션→실제 경로 매핑 가능하게 함
  const directoryMapBlock = directoryMap
    ? `\n### Actual Directory Structure (use to map sections to real paths and generate accurate filePaths)\n<directory_map>\n${directoryMap}\n</directory_map>\n`
    : '';

  // For large projects, directoryMap is the AUTHORITATIVE structure source.
  // The truncated file_tree is biased to alphabetically-early directories and
  // must NOT be used as the primary input — it causes the LLM to hallucinate
  // a CLI/extensions-only ToC for projects like VSCode.
  const isLargeProject = actualFileCount > 2000;

  // Graphify arch summary는 의미 기반 컴포넌트 그래프 — directoryMap(경로 목록)보다 품질 높음
  const primaryStructureBlock = graphifyArchSummary
    ? `1. Architecture knowledge graph (AUTHORITATIVE — semantic component graph, not just file paths):\n<architecture_graph>\n${graphifyArchSummary}\n</architecture_graph>`
    : `1. Project architecture map (AUTHORITATIVE — derived from the COMPLETE file tree):\n<directory_map>\n${directoryMap}\n</directory_map>`;

  const largeProjectStructure = isLargeProject ? `\
${primaryStructureBlock}

2. README:
<readme>
${readme}
</readme>

3. File sample (first ${Math.min(400, file_tree.split('\n').length)} lines of ${actualFileCount} total files — alphabetically ordered, NOT representative of the full architecture):
<file_sample>
${file_tree.split('\n').slice(0, 400).join('\n')}
</file_sample>

IMPORTANT: Section 1 above is derived from the complete codebase and is authoritative.
The <file_sample> is alphabetically-biased and may UNDER-REPRESENT major subsystems.
Always use Section 1 to determine what sections to create.` : '';

  const smallProjectStructure = !isLargeProject ? `\
${graphifyArchSummary
  ? `1. Architecture knowledge graph (AUTHORITATIVE — semantic component graph):\n<architecture_graph>\n${graphifyArchSummary}\n</architecture_graph>\n\n2. File tree:\n<file_tree>\n${file_tree}\n</file_tree>`
  : `1. File tree:\n<file_tree>\n${file_tree}\n</file_tree>`}

${graphifyArchSummary ? '3.' : '2.'} README:
<readme>
${readme}
</readme>` : '';

  const structurePrompt = `Analyze this repository and create a wiki structure for it.
${isLargeProject ? largeProjectStructure : smallProjectStructure}

${isLargeProject ? `4. Project scale: ${actualFileCount} source files total.` : `3. Project scale: ${actualFileCount} source files total.`}
${languageInstruction}

${projectTypeHints(projectType)}
${isLargeProject ? '' : directoryMapBlock}
${subsystemSection}
${feedbackSection}
### Page Structure (MANDATORY)
This project has ${actualFileCount} files.
- You MUST create one rootSection per area listed in the project type hints above.
- DO NOT merge multiple listed areas into a single section.
- DO NOT reduce the section count — every listed area is mandatory.
- Within each section, generate focused pages that each cover a DISTINCT sub-component. Only add a page if it has enough unique content to stand alone — do NOT split one topic into multiple thin pages just to increase count.

### Naming Conventions
1. \`title\` fields MUST use Title Case: "Getting Started", "Extension Architecture". NEVER snake_case or camelCase.
2. \`id\` fields MUST use kebab-case: "getting-started", "extension-architecture", "data-flow". NEVER snake_case, camelCase, or PascalCase.
3. ${effectiveWikiLanguage(language) === 'ko' ? 'Titles may be English technical terms or Korean — use whichever is clearest.' : 'Write all titles in English.'}

### Section Ordering
rootSections order: Getting Started first, then Architecture, then feature subsystems, then advanced/internals.

CRITICAL: Output ONLY a single valid JSON object:
{
  "title": "...",
  "description": "...",
  "rootSections": ["section1"],
  "sections": [{ "id": "section1", "title": "...", "pages": ["page1"] }],
  "pages": [{ "id": "page1", "title": "...", "filePaths": ["src/index.ts"] }]
}
Your FIRST character must be "{" and LAST must be "}". No prose, no markdown fences, no wiki content.`;

  await emitStep(streamId, 'agent_log', 'structure',
    `📋 ToC 생성 프롬프트 전송 (subsystems=${subsystems.length})...`);

  const STRICT_SUFFIX = '\n\nREMINDER: Output ONLY the JSON object. First char "{", last "}". No prose, no markdown.';
  let wikiStructure: any = null;
  let lastErr = '';

  for (let attempt = 0; attempt < 2 && !wikiStructure; attempt++) {
    let content = '';
    try {
      content = await streamLLM(attempt === 0 ? structurePrompt : structurePrompt + STRICT_SUFFIX);
    } catch (err) {
      await emitStep(streamId, 'error', 'structure',
        `❌ AI 구조 분석 실패: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    await emitStep(streamId, 'agent_log', 'structure',
      content.length === 0
        ? `⚠️ AI 응답 비어있음 (attempt ${attempt + 1})`
        : `🤖 AI 응답 수신 (${content.length}자):\n${content.slice(0, 400)}…`);

    const parsed = extractJson(content);
    if (parsed) {
      wikiStructure = parsed;
      if (!wikiStructure.id) wikiStructure.id = "wiki";
      if (!wikiStructure.description) wikiStructure.description = `${repo} wiki`;
      if (!wikiStructure.title) wikiStructure.title = `${repo} Wiki`;
      if (!wikiStructure.pages && Array.isArray(wikiStructure.items)) {
        wikiStructure.pages = _flattenItemsToPages(wikiStructure.items);
        wikiStructure.sections = _buildSectionsFromItems(wikiStructure.items);
        wikiStructure.rootSections = wikiStructure.items.map((i: any) => i.name || i.id).filter(Boolean);
        delete wikiStructure.items;
      }
      if (!Array.isArray(wikiStructure.pages)) wikiStructure.pages = [];
      if (!Array.isArray(wikiStructure.sections)) wikiStructure.sections = [];
      if (!Array.isArray(wikiStructure.rootSections)) wikiStructure.rootSections = [];
      // Normalize all IDs to kebab-case regardless of what the LLM produced
      _normalizeStructureIds(wikiStructure);
    } else {
      lastErr = `AI 응답에서 JSON 없음 (${content.length}자): ${content.slice(0, 300)}`;
    }
    if (!wikiStructure && attempt === 0) {
      await emitStep(streamId, 'agent_log', 'structure', '⚠️ JSON 추출 실패 — 재시도...');
    }
  }

  if (!wikiStructure) {
    await emitStep(streamId, 'error', 'structure', `❌ 위키 구조 JSON 파싱 실패: ${lastErr}`);
    throw new Error(`위키 구조 파싱 실패: ${lastErr}`);
  }

  // ── Multi-project post-processing: force each detected sub-project into its own rootSection ──
  // Even if the LLM ignored the MANDATORY instruction and grouped services into a "Deep Dive" section,
  // we repair the structure here to ensure every sub-project gets 3 proper pages.
  if (projectType === 'multi-project' && subsystems.length >= 2) {
    const existingSectionIds = new Set((wikiStructure.sections || []).map((s: any) => s.id));
    const missing = subsystems.filter(sub => !existingSectionIds.has(sub.id));
    if (missing.length >= 2) {
      await emitStep(streamId, 'agent_log', 'structure',
        `🔧 Multi-project 구조 보정: ${missing.length}개 서브프로젝트를 rootSection으로 승격`);
      const existingPageIds = new Set((wikiStructure.pages || []).map((p: any) => p.id));
      for (const sub of missing) {
        const ids = [`${sub.id}-api`, `${sub.id}-domain`, `${sub.id}-architecture`];
        wikiStructure.sections.push({ id: sub.id, title: sub.name, pages: ids });
        if (!wikiStructure.rootSections.includes(sub.id)) wikiStructure.rootSections.push(sub.id);
        const titles = ['API Contract', 'Domain Model', 'Internal Architecture'];
        ids.forEach((id, i) => {
          if (!existingPageIds.has(id)) {
            wikiStructure.pages.push({ id, title: `${sub.name} — ${titles[i]}`, filePaths: sub.paths });
            existingPageIds.add(id);
          }
        });
      }
    }
  }

  const pageCount = (wikiStructure.pages || []).length;
  const sectionCount = (wikiStructure.sections || []).length;

  // EDA: structure.preview 이벤트 emit — onEvent에서 awaitingApproval 전환
  await emitStep(streamId, 'structure.preview', 'structure',
    `📋 위키 구조 준비 완료 — ${sectionCount}개 섹션, ${pageCount}개 페이지`,
    { wiki_structure: wikiStructure, page_count: pageCount, section_count: sectionCount }
  );

  await emitStep(streamId, 'phase_complete', 'structure',
    `✅ 위키 구조 분석 완료 — ${sectionCount}개 섹션, ${pageCount}개 페이지 (${elapsed(t2)}ms)`,
    { page_count: pageCount, section_count: sectionCount, elapsed_ms: elapsed(t2) }
  );

  return { wikiStructure, pageCount, sectionCount, projectType, actualFileCount, file_tree, readme, subsystems, graphifyArchSummary };
}

// ─── Full Pipeline: Phase 2.5 → 5 ────────────────────────────────────────────

export async function runWikiGeneration(
  projectPath: string,
  streamId: string,
  outputLanguage: string = "ko",
  testMode: boolean = false,
  provider: string = "google",
  model: string = "gemini-2.5-flash",
  apiKey?: string,
  mode: "cli" | "api" = "cli",
  cliTool?: string,
  enableBusiness?: boolean,
  pipelineFlags?: { mcp?: boolean; concurrency?: number },
  preBuiltStructure?: WikiStructureResult,
  resumeData?: { skipPageIds?: string[]; cachedPages?: Record<string, any> },
  stopSignal?: { stopped: boolean },
) {
  const owner = "local";
  // 경로 끝 슬래시 제거 후 디렉토리명 추출
  const rawName = projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  // 허용 문자(영문·숫자·한글·하이픈·언더스코어·점) 외 모두 _로 치환, 연속 _ 정리
  const repo = rawName
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "")
    || "project";

  const repo_type = "local";
  const language = outputLanguage;

  const languageInstruction = wikiLanguageInstruction(language);

  const pipelineStart = Date.now();

  // ──────────────────────────────────────────────────────────
  // Phase 0: MCP 활성 여부 결정 (설정 기반 자동 감지)
  // ──────────────────────────────────────────────────────────
  let mcpEnabled = pipelineFlags?.mcp ?? false;
  if (pipelineFlags?.mcp === undefined) {
    try {
      const r = await fetch('/api/settings/mcp_settings');
      if (r.ok) {
        const data = await r.json();
        const providers: any[] = data.value?.providers ?? [];
        mcpEnabled = providers.some((p: any) => p.isEnabled === true);
      }
    } catch {}
  }

  // Register job in DB for checkpoint/resume tracking (non-fatal)
  try {
    await fetch('/api/wiki/start-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: streamId, owner, repo, language, model }),
    });
  } catch { /* non-fatal — DB tracking optional */ }

  try {
    // ──────────────────────────────────────────────────────────
    // Phase 1–2: Structure (preBuiltStructure 있으면 skip)
    // ──────────────────────────────────────────────────────────
    let structureResult: WikiStructureResult;

    if (preBuiltStructure) {
      structureResult = preBuiltStructure;
      await emitStep(streamId, 'agent_log', 'generation',
        `✅ 승인된 구조로 페이지 생성을 시작합니다 (${preBuiltStructure.pageCount}개 페이지)...`);
    } else {
      structureResult = await runWikiStructure(
        projectPath, streamId, outputLanguage, testMode,
        provider, model, apiKey, mode, cliTool, pipelineFlags,
      );
    }

    const { wikiStructure, projectType, file_tree, readme, actualFileCount } = structureResult;
    // Graphify 아키텍처 요약 — preBuiltStructure에서 전달받거나 없으면 재fetch
    let graphifyArchSummary = structureResult.graphifyArchSummary ?? '';
    if (!graphifyArchSummary) {
      try {
        const archRes = await fetch('/api/graph/architecture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo_path: projectPath }),
        });
        if (archRes.ok) {
          const d = await archRes.json();
          graphifyArchSummary = d.summary ?? '';
        }
      } catch { /* Graphify 없으면 empty — Phase 4.5 fallback 동작 */ }
    }

    // ──────────────────────────────────────────────────────────
    // Phase 2.5: Git roots → LLM에게 절대 GitHub URL 제공
    // ──────────────────────────────────────────────────────────
    let gitRootsForPrompt = '';
    // Primary root's GitHub URL saved here and embedded in cache so links work
    // even in showcase/offline mode (where /api/git_roots cannot be called).
    let detectedGithubRepoUrl: string | null = null;
    let detectedGithubBranch = 'main';
    try {
      const grRes = await fetch(`/api/git_roots?path=${encodeURIComponent(projectPath)}`);
      if (grRes.ok) {
        const grData = await grRes.json();
        const roots: any[] = grData.roots || [];
        if (roots.length > 0) {
          const primaryRoot = roots.find((r: any) => r.prefix === '' && r.webUrl) || roots.find((r: any) => r.webUrl);
          if (primaryRoot) {
            detectedGithubRepoUrl = primaryRoot.webUrl.replace(/\.git$/, '').replace(/\/$/, '');
            detectedGithubBranch = primaryRoot.branch || 'main';
          }
          const rootLines = roots
            .filter((r: any) => r.webUrl)
            .map((r: any) => {
              const label = r.prefix ? `"${r.prefix}/" subdirectory` : 'repository root';
              return `  - ${label}: ${r.webUrl} (default branch: ${r.branch || 'main'})`;
            })
            .join('\n');
          const exRoot = roots.find((r: any) => r.webUrl) as any;
          const exUrl = exRoot
            ? `${exRoot.webUrl}/blob/${exRoot.branch || 'main'}/path/to/SomeFile.java`
            : '';
          const isPolyrepo = roots.filter((r: any) => r.prefix).length > 1;
          if (rootLines) {
            const polyrepoWarning = isPolyrepo
              ? '⚠️ POLYREPO STRUCTURE: Each top-level subdirectory is a SEPARATE independent GitHub repository.\n'
              + 'The parent directory (local aggregate) does NOT exist as a GitHub repo — do NOT use its name in any URL.\n'
              : '';
            const polyrepoRules = isPolyrepo
              ? '\n2. File paths MUST include the service subdirectory prefix (e.g. affiliate-event/src/main/.../Foo.java). NEVER use just the filename Foo.java — the renderer cannot determine which repo it belongs to without the prefix.'
              + '\n3. The local parent directory name is NOT a GitHub repo. NEVER construct URLs like https://github.xxx.com/affiliate/blob/...'
              : '';
            gitRootsForPrompt = '\n### Source Repository GitHub URLs (MANDATORY)\n'
              + polyrepoWarning
              + 'Each repository maps to:\n'
              + rootLines + '\n'
              + (exUrl ? 'File link example: ' + exUrl + '\n' : '')
              + 'LINKING RULES (strictly enforced):\n'
              + '1. Every hyperlink to a file, class, or module MUST start with https://.'
              + polyrepoRules + '\n';
          }
        }
      }
    } catch { /* non-fatal — generation continues without URL hints */ }

    // ──────────────────────────────────────────────────────────
    // Phase 3 + 4: MCP 활성화된 경우에만 실행
    // ──────────────────────────────────────────────────────────
    let codeEntities: Record<string, any> | null = null;
    let mcpContext: Record<string, string> = {};

    if (mcpEnabled) {
      // Phase 2.5: 코드 엔티티 추출 (CodeGraph 우선 / regex 폴백)
      const allFilePaths = [...new Set(
        (wikiStructure.pages || []).flatMap((p: any) => p.filePaths || [])
      )];
      try {
        const entRes = await fetch('/api/code/extract-entities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_path: projectPath, file_paths: allFilePaths, stream_id: streamId }),
        });
        if (entRes.ok) {
          codeEntities = await entRes.json();
        }
      } catch (e) {
        await emitStep(streamId, 'agent_log', 'extract', `⚠️ 엔티티 추출 실패, 계속 진행: ${e}`);
      }

      // Phase 3: MCP 크로스체크 (엔티티 기반 역조회)
      const hasMeaningfulEntities = (
        (codeEntities?.db_tables?.length ?? 0) > 0 ||
        (codeEntities?.stored_procs?.length ?? 0) > 0 ||
        (codeEntities?.kafka_topics?.length ?? 0) > 0 ||
        (codeEntities?.service_names?.length ?? 0) > 0
      );
      if (!hasMeaningfulEntities) {
        await emitStep(streamId, 'agent_log', 'mcp',
          '⏭️ MCP 크로스체크 건너뜀 — 이 프로젝트에서 DB 테이블·SP·Kafka 토픽·서비스 엔티티를 찾지 못했습니다');
      } else try {
        const mcpRes = await fetch('/api/mcp/collect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_path: projectPath,
            entities: codeEntities ?? {},
            topic_hint: (wikiStructure as any).description || '',
            stream_id: streamId,
          }),
        });
        if (mcpRes.ok) {
          const mcpResult = await mcpRes.json();
          if (mcpResult.ok && mcpResult.contexts) {
            mcpContext = mcpResult.contexts as Record<string, string>;
            const providerCount = Object.keys(mcpContext).length;
            if (providerCount > 0) {
              await emitStep(streamId, 'agent_log', 'mcp',
                `🔌 MCP 컨텍스트 수집 완료 — ${providerCount}개 소스 (${Object.keys(mcpContext).join(', ')})`);
            }
          }
        }
      } catch (e) {
        await emitStep(streamId, 'agent_log', 'mcp', `⚠️ MCP 크로스체크 실패, 계속 진행: ${e}`);
      }
    }

    // ──────────────────────────────────────────────────────────
    // Phase 4: 페이지 콘텐츠 생성
    // ──────────────────────────────────────────────────────────
    const t3 = Date.now();
    const pageCount = (wikiStructure.pages || []).length;
    await emitStep(streamId, 'phase_start', 'generation', `📝 ${pageCount}개 페이지 콘텐츠 생성 시작...`);

    const generatedPages: Record<string, any> = {};
    let pagesToGenerate = wikiStructure.pages || [];

    if (testMode && pagesToGenerate.length > 0) {
      await emitStep(streamId, 'agent_log', 'generation', '⚠️ 테스트 모드: 첫 번째 페이지만 생성합니다.');
      pagesToGenerate = pagesToGenerate.slice(0, 1);
      wikiStructure.pages = pagesToGenerate;
      if (wikiStructure.sections) {
        wikiStructure.sections = wikiStructure.sections.map((sec: any) => ({
          ...sec,
          pages: sec.pages.filter((pid: string) => pagesToGenerate.some((p: any) => p.id === pid))
        })).filter((sec: any) => sec.pages.length > 0);
      }
    }

    let successPages = 0;
    let failPages = 0;

    // Pre-populate resumed pages from wikicache so Phase 4.5 + Phase 5 see full set
    if (resumeData?.cachedPages) {
      for (const [id, page] of Object.entries(resumeData.cachedPages)) {
        generatedPages[id] = page;
        successPages++;
      }
    }

    // Skip already-completed pages when resuming
    if (resumeData?.skipPageIds?.length) {
      const skipSet = new Set(resumeData.skipPageIds);
      pagesToGenerate = pagesToGenerate.filter((p: any) => !skipSet.has(p.id));
      await emitStep(streamId, 'agent_log', 'generation',
        `⏭️ ${resumeData.skipPageIds.length}개 페이지 재개 완료, ${pagesToGenerate.length}개 페이지 신규 생성`);
    }

    const MCP_TOPIC_KEYWORDS = [
      'schema', 'database', 'table', 'model', 'migration', 'sql',
      'kafka', 'queue', 'topic', 'redis', 'cache',
      'api', 'endpoint', 'route', 'confluence', 'issue',
    ];
    const buildMcpContextForPage = (page: { title: string }): string => {
      if (Object.keys(mcpContext).length === 0) return '';
      const titleLower = page.title.toLowerCase();
      if (!MCP_TOPIC_KEYWORDS.some(kw => titleLower.includes(kw))) return '';
      return '\n' + Object.entries(mcpContext).slice(0, 2)
        .map(([label, ctx]) => `<mcp_context source="${label}">\n${ctx.slice(0, 1500)}\n</mcp_context>`)
        .join('\n\n') +
        '\n\n### MCP Cross-Check Data\nThe XML blocks above contain REAL data fetched from connected MCP sources (DB schemas, stored procedures, GitHub issues, Confluence docs). Reference this data directly when writing about relevant components.\n';
    };

    const isRateLimitError = (err: unknown): boolean => {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
        msg.includes('rate_limit') || msg.includes('resource exhausted') || msg.includes('too many requests');
    };

    const isTransientError = (err: unknown): boolean => {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      return msg.includes('empty response') || msg.includes('timeout') ||
        msg.includes('econnreset') || msg.includes('network') || msg.includes('aborted') ||
        err instanceof Error && err.name === 'AbortError';
    };

    // ── business flow helpers ──────────────────────────────────────────────
    function loadFlowsConfig(): McpInstance[] {
      try {
        const configPath = new URL('../../flows/local-wiki.flows.json', import.meta.url).pathname;
        return JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpInstances ?? [];
      } catch {
        return [];
      }
    }

    function isBusinessFlowPage(page: { id: string; title: string }): boolean {
      const s = `${page.id} ${page.title}`.toLowerCase();
      return s.includes('business-flow') || s.includes('business flow') || s.includes('비즈니스 플로우');
    }

    // ── per-page generation (inner function capturing outer scope) ─────────
    const generateOnePage = async (page: any, signal?: AbortSignal): Promise<any> => {
      const tPage = Date.now();
      const pageNum = successPages + failPages + 1;
      await emitStep(streamId, 'page_start', 'generation',
        `📄 "${page.title}" 페이지 생성 중... (${pageNum}/${pagesToGenerate.length})`,
        { page_id: page.id, page_title: page.title }
      );

      // CodeGraph/Graphify 심볼 컨텍스트
      let symbolContextBlock = '';
      try {
        const graphRes = await fetch('/api/graph/page-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo_path: projectPath, page_title: page.title,
            page_id: page.id, file_paths: page.filePaths ?? [],
          }),
        });
        if (graphRes.ok) {
          const graphData = await graphRes.json();
          if (graphData.context) {
            symbolContextBlock = `\n### Code Symbol Context\n<code_symbols>\n${graphData.context}\n</code_symbols>\nUse the symbol definitions above to write accurate, citation-backed content.\n`;
          }
        }
      } catch { /* no index — fall back to file paths */ }

      const sourceFilesText = page.filePaths && page.filePaths.length > 0
        ? `Source files to base content on:\n${page.filePaths.join('\n')}\n\nEnsure you cite the source files explicitly.`
        : `Analyze the repository codebase to gather relevant information for this topic.`;

      const sectionTitle = (wikiStructure.sections || []).find((s: any) => (s.pages || []).includes(page.id))?.title || '';
      const topicReq = [
        topicRequirements(sectionTitle, page.title),
        projectTypeTopicRequirements(projectType, sectionTitle, page.title),
      ].filter(Boolean).join('\n');

      let pagePrompt = `You are an expert technical writer and software architect analyzing a REAL production codebase.
Your task is to generate a comprehensive, in-depth technical wiki page in Markdown format.

Topic: "${page.title}"
${sourceFilesText}
${symbolContextBlock}
${gitRootsForPrompt}
### Content Requirements (MANDATORY)
- Write SUBSTANTIVE content with at least 4-6 major sections (## headings) and subsections (### headings) where relevant.
- CITE specific file paths, class names, function names, and module names from the source files listed above. Every major claim must reference an actual file or symbol — no invented or generic filler.
- Include at least ONE Mermaid diagram (architecture, component relationship, or sequence flow).
- For each key component or subsystem: explain (1) WHAT it does, (2) HOW it works internally, (3) WHY it is designed this way if non-obvious.
- Write for a senior engineer onboarding to this specific codebase — assume they can read code but need the big-picture design decisions and non-obvious behaviors explained.

${topicReq}
${buildMcpContextForPage(page)}
### Mermaid Diagram Rules
1. **Choose the Best Direction:** Use \`graph TD\` (Top-Down) for hierarchical structures or \`graph LR\` (Left-Right) for pipelines and data flows. Choose the direction that naturally minimizes crossing lines.
2. **Structured Layout with Subgraphs:** You MUST heavily use \`subgraph\` blocks to logically group related nodes into layers or components (e.g., "Core Interfaces", "CLI Layer", "API Clients", "External Endpoints"). This is CRITICAL for creating clean, professional architecture diagrams and preventing spaghetti lines.
3. **Subgraph Syntax:** NEVER use quotes directly for subgraph labels in a way that breaks syntax (e.g., \`subgraph ID "Label"\`). Instead, use the format \`subgraph ID ["Label"]\` or simply avoid quotes and special characters in subgraph IDs.
4. **Node Formatting & Quoting:** You MUST wrap ALL node labels in double quotes to prevent syntax errors, especially if they contain special characters (like \`()\`, \`@\`, \`/\`, space) or HTML tags like \`<br>\`. Example: \`NodeID["Label text <br> (Extra Info)"]\`. NEVER use literal newline characters (\\\\n) inside labels. Keep relationships concise.
5. **Eliminate Spaghetti Lines:** Minimize crossing edges. By grouping nodes into logical subgraphs and strictly routing dependencies layer-by-layer, you must avoid chaotic cross-references.
6. **Edge Label Quoting (CRITICAL):** NEVER wrap flowchart edge labels with double quotes inside pipes. Use plain text only: write \`A -->|Label text| B\` NOT \`A -->|"Label text"| B\`. Quotes inside \`|...\` cause a parse error in Mermaid v11.
7. **erDiagram Label Rules (CRITICAL):** In \`erDiagram\`, relationship labels MUST be plain identifiers with NO parentheses, brackets, or special characters. Write \`CUSTOMER ||--o{ ORDER : places\` NOT \`CUSTOMER ||--o{ ORDER : "places (orders)"\`. Parentheses inside erDiagram labels always cause a parse error.

${languageInstruction}
${STRICT_FORMAT_RULES}`;

      // catalog-based flow enrichment (optional layer — enriches if catalog exists)
      if (isBusinessFlowPage(page)) {
        const catalogPath = path.join(projectPath, '../flows/catalog.yaml');
        if (fs.existsSync(catalogPath)) {
          const flow = findFlow(loadCatalog(catalogPath), page.id);
          if (flow) {
            pagePrompt = buildFlowPrompt(flow, loadFlowsConfig());
            await emitStep(streamId, 'agent_log', 'generation',
              `🗄️ "${page.title}" — catalog-enriched flow prompt applied (${flow.id})`);
          }
        }
      }

      const pageReqBody = {
        repo_url: projectPath, type: repo_type, stream_id: streamId,
        messages: [{ role: 'user', content: pagePrompt }],
        model, provider, language, skip_rag: true, is_wiki_generation: true,
        ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      };

      let pageContent = await fetchContent('/api/chat/stream', pageReqBody, { pageId: page.id, signal });
      pageContent = normalizeMarkdownContent(pageContent);

      // Mermaid 자가수정 레이어
      const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
      const mMatches = [...pageContent.matchAll(mermaidRegex)];
      if (mMatches.length > 0) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', suppressErrorRendering: true });
        for (let mi = 0; mi < mMatches.length; mi++) {
          const fullMatch = mMatches[mi][0];
          const diagramCode = mMatches[mi][1];
          try {
            await mermaid.parse(diagramCode);
          } catch (parseError: any) {
            // parse() can be stricter than render() — skip LLM fix if render succeeds
            try {
              await mermaid.render(`validate-gen-${mi}`, diagramCode);
              continue;
            } catch { /* render also fails — proceed with fix */ }

            const errMsg = parseError.message || String(parseError);
            await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 구문 오류 감지, 로컬 자동수정 시도 중...`);
            const localFixed = autoFixMermaid(diagramCode);
            if (localFixed !== diagramCode) {
              try {
                await mermaid.parse(localFixed);
                pageContent = pageContent.replace(fullMatch, `\`\`\`mermaid\n${localFixed}\n\`\`\``);
                await emitStep(streamId, 'agent_log', 'generation', `✅ 다이어그램 로컬 자동수정 성공`);
                continue;
              } catch { /* fall through to LLM fix */ }
            }
            const fixPrompt = `The following Mermaid diagram has a syntax error:\n\n${errMsg}\n\nOriginal Diagram:\n\`\`\`mermaid\n${diagramCode}\n\`\`\`\n\nFix the syntax error. CRITICAL: You MUST wrap all node labels in double quotes if they contain parentheses, brackets, special characters, or HTML tags (e.g., Change \`ID[Text (info)]\` to \`ID["Text (info)"]\`). Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.\n${STRICT_FORMAT_RULES}`;
            try {
              const fixContent = await fetchContent('/api/chat/stream', { ...pageReqBody, messages: [{ role: 'user', content: fixPrompt }] }, {});
              const fixedMatch = fixContent.match(/```mermaid\n([\s\S]*?)\n```/i);
              if (fixedMatch) {
                pageContent = pageContent.replace(fullMatch, fixedMatch[0]);
                await emitStep(streamId, 'agent_log', 'generation', `✅ 다이어그램 자동 복구 성공!`);
              }
            } catch {
              await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 복구 실패: 원본 유지됨`);
            }
          }
        }
      }

      const pageResult = {
        id: page.id, title: page.title, content: pageContent,
        filePaths: page.filePaths || [], importance: page.importance || 'medium',
        relatedPages: page.relatedPages || [],
      };

      // Checkpoint: persist completion to DB (non-fatal)
      try {
        await fetch('/api/wiki/checkpoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: streamId, page_id: page.id, page_title: page.title, content: pageResult.content }),
        });
      } catch { /* non-fatal */ }

      await emitStep(streamId, 'page_complete', 'generation',
        `✅ "${page.title}" 완료 (${elapsed(tPage)}ms, ${pageContent.length}자)`,
        { page_id: page.id, content_length: pageContent.length, elapsed_ms: elapsed(tPage) }
      );
      return pageResult;
    };

    // ── Kafka-style consumer pool ──────────────────────────────────────────
    // taskQueue: JS 단일 스레드라 shift()는 사실상 atomic
    // AbortController per page: 5분 응답 없으면 해당 워커만 탈출, 큐에 재삽입
    const PAGE_CONCURRENCY = Math.min(10, Math.max(1, pipelineFlags?.concurrency ?? 3));
    const MAX_PAGE_TIMEOUT_MS = 5 * 60 * 1000; // 5분
    const MAX_RETRIES = 2;
    let rateLimitHit = false;

    const taskQueue: any[] = [...pagesToGenerate];
    const retryCountMap = new Map<string, number>();

    await emitStep(streamId, 'agent_log', 'generation',
      `📦 ${pagesToGenerate.length}개 페이지 생성 시작 (동시 ${PAGE_CONCURRENCY}개)...`);

    async function worker() {
      while (!rateLimitHit && !stopSignal?.stopped) {
        const page = taskQueue.shift();
        if (!page) break;

        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), MAX_PAGE_TIMEOUT_MS);

        try {
          const result = await generateOnePage(page, abort.signal);
          clearTimeout(timer);
          generatedPages[page.id] = result;
          successPages++;
        } catch (err: unknown) {
          clearTimeout(timer);
          const errMsg = err instanceof Error ? err.message : String(err);
          const retries = retryCountMap.get(page.id) ?? 0;

          if (isRateLimitError(err)) {
            rateLimitHit = true;
            taskQueue.unshift(page); // 다음 재개 시 첫 번째로
            try {
              await fetch('/api/wiki/interrupt-job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: streamId, error: 'rate_limit' }),
              });
            } catch { /* non-fatal */ }
            await emitStep(streamId, 'error', 'generation',
              `⛔ API 레이트 리밋 도달 — 생성 중단됨 (${successPages}/${pagesToGenerate.length + (resumeData?.skipPageIds?.length ?? 0)} 완료). 프로젝트 목록에서 "이어서 생성"으로 재개하세요.`
            );
            break;
          }

          if (isTransientError(err) && retries < MAX_RETRIES) {
            // 타임아웃 또는 일시 오류 → 큐 끝에 재삽입 (Kafka 리밸런싱)
            retryCountMap.set(page.id, retries + 1);
            taskQueue.push(page);
            const label = err instanceof Error && err.name === 'AbortError' ? '타임아웃' : '일시 오류';
            await emitStep(streamId, 'agent_log', 'generation',
              `⚠️ "${page.title}" ${label} — 큐 재삽입 (${retries + 1}/${MAX_RETRIES}회)`);
          } else {
            // 최대 재시도 초과 또는 치명 오류 → stub 처리
            failPages++;
            emitStep(streamId, 'error', 'generation',
              `❌ "${page.title}" 생성 실패: ${errMsg}`,
              { page_id: page.id, error: errMsg }
            );
            generatedPages[page.id] = {
              id: page.id, title: page.title,
              content: `# ${page.title}\n\n> ⚠️ 생성 실패: ${errMsg}`,
              filePaths: page.filePaths || [], importance: page.importance || 'medium',
              relatedPages: page.relatedPages || [],
            };
          }
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, taskQueue.length) }, () => worker())
    );

    if (stopSignal?.stopped) {
      await emitStep(streamId, 'agent_log', 'generation',
        `⏸ 생성 중지됨 — ${successPages}개 완료, ${taskQueue.length}개 남음`);
      return;
    }

    await emitStep(streamId, 'phase_complete', 'generation',
      `✅ 페이지 생성 완료 — ${successPages}개 성공, ${failPages}개 실패 (${elapsed(t3)}ms)`,
      { success: successPages, failed: failPages, elapsed_ms: elapsed(t3) }
    );

    // ──────────────────────────────────────────────────────────
    // Phase 4.5: 종합 인사이트 페이지 생성 (6종)
    // ──────────────────────────────────────────────────────────
    const t45 = Date.now();
    await emitStep(streamId, 'phase_start', 'synthesis', '🧠 종합 인사이트 페이지 생성 시작...');

    const SYNTHESIS_PAGES = [
      {
        id: 'business_flow',
        title: 'Business Flow',
        prompt: 'Trace the complete business flow: how a user request enters the system, passes through the business logic layer, and results in data changes or responses. Focus on the happy path, key business rules, validation steps, and transaction boundaries.',
      },
      {
        id: 'data_flow',
        title: 'Data Flow',
        prompt: 'Document the data flow: all data sources (databases, message queues, external APIs), how data moves through transformation layers, and where it is stored or forwarded. Include Kafka topics, DB tables, caches, and inter-service calls.',
      },
      {
        id: 'debugging_flow',
        title: 'Debugging Flow',
        prompt: 'Create a debugging guide: key error paths, retry mechanisms, circuit breakers, fallback patterns, and the most common failure points. Explain how to trace a failure from symptom to root cause using logs, metrics, and code.',
      },
      {
        id: 'monitoring_points',
        title: 'Monitoring Points',
        prompt: 'Identify all observability hooks: logging statements, metrics emissions, health check endpoints, alert trigger conditions, and dashboard-relevant data points. Explain what each monitor tracks and why it matters in production.',
      },
      {
        id: 'service_dependency_map',
        title: 'Service Map',
        prompt: 'Build a complete service dependency map: all internal and external services, their communication protocols (HTTP/REST, gRPC, Kafka, direct DB), dependency direction, and SLA implications. Include a Mermaid graph diagram.',
      },
      {
        id: 'change_impact',
        title: 'Change Impact Guide',
        prompt: 'Document change impact chains: which files/modules, when changed, ripple to which downstream components. Explain how to assess blast radius before making changes to core services, shared libraries, or data models.',
      },
    ];

    // Phase 4.5 인사이트 컨텍스트: Graphify 요약(의미 기반) > 섹션/페이지 제목 목록 > raw 스니펫
    // graphifyArchSummary는 Phase 1.6에서 이미 fetch된 값 — 재사용, 추가 API 비용 없음
    const pageSummaries = graphifyArchSummary
      ? `## Architecture Graph\n${graphifyArchSummary}`
      : (wikiStructure.sections || [])
          .map((s: any) => `## ${s.title}\n${(s.pages || []).map((pid: string) => {
            const p = generatedPages[pid];
            return p ? `- ${p.title}` : null;
          }).filter(Boolean).join('\n')}`)
          .join('\n\n')
        || Object.values(generatedPages)
            .slice(0, 20)
            .map((p: any) => `### ${p.title}\n${(p.content || '').slice(0, 200)}`)
            .join('\n\n---\n\n');

    const entitySummary = codeEntities
      ? [
          (codeEntities.db_tables?.length ?? 0) > 0 ? `DB Tables: ${(codeEntities.db_tables as string[]).slice(0, 20).join(', ')}` : '',
          (codeEntities.stored_procs?.length ?? 0) > 0 ? `Stored Procs: ${(codeEntities.stored_procs as string[]).slice(0, 10).join(', ')}` : '',
          (codeEntities.kafka_topics?.length ?? 0) > 0 ? `Kafka Topics: ${(codeEntities.kafka_topics as string[]).slice(0, 10).join(', ')}` : '',
          (codeEntities.api_endpoints?.length ?? 0) > 0 ? `API Endpoints: ${(codeEntities.api_endpoints as string[]).slice(0, 15).join(', ')}` : '',
          (codeEntities.service_names?.length ?? 0) > 0 ? `Services: ${(codeEntities.service_names as string[]).slice(0, 10).join(', ')}` : '',
        ].filter(Boolean).join('\n')
      : '';

    const mcpSummaryForSynthesis = Object.keys(mcpContext).length > 0
      ? Object.entries(mcpContext).map(([label, ctx]) =>
          `<mcp_context source="${label}">\n${ctx.slice(0, 2000)}\n</mcp_context>`
        ).join('\n\n')
      : '';

    const synthesisPageIds: string[] = [];

    for (const spec of SYNTHESIS_PAGES) {
      const tSyn = Date.now();
      await emitStep(streamId, 'agent_log', 'synthesis',
        `🧠 "${spec.title}" 인사이트 페이지 생성 중...`,
        { page_id: spec.id, page_title: spec.title }
      );

      const synthesisPrompt = `You are an expert software architect. Based on the wiki pages, extracted code entities, and MCP cross-check data below, generate a comprehensive "${spec.title}" insight page in Markdown.

## Task
${spec.prompt}

## Extracted Code Entities
${entitySummary || '(not available)'}

${mcpSummaryForSynthesis ? `## MCP Cross-Check Data\n${mcpSummaryForSynthesis}\n` : ''}

## Existing Wiki Page Summaries
${pageSummaries}

### Output Requirements
- Write 4-6 major sections (## headings) with subsections (### headings) where appropriate.
- Reference real file paths, class names, function names, and table names found in the summaries or entity list above.
- Include at least one Mermaid diagram where it adds clarity.
- Be specific and evidence-based: every claim must trace back to the summaries or MCP data.
- Write for a senior engineer who needs to understand the system quickly.

${languageInstruction}
${STRICT_FORMAT_RULES}`;

      const synReqBody = {
        repo_url: projectPath,
        type: repo_type,
        stream_id: streamId,
        messages: [{ role: 'user', content: synthesisPrompt }],
        model,
        provider,
        language,
        skip_rag: true,
        is_wiki_generation: true,
        ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      };

      try {
        let synContent = await fetchContent('/api/chat/stream', synReqBody, { pageId: spec.id });
        synContent = normalizeMarkdownContent(synContent);

        generatedPages[spec.id] = {
          id: spec.id,
          title: spec.title,
          content: synContent,
          filePaths: [],
          importance: 'high',
          relatedPages: [],
        };
        synthesisPageIds.push(spec.id);

        await emitStep(streamId, 'agent_log', 'synthesis',
          `✅ "${spec.title}" 완료 (${elapsed(tSyn)}ms, ${synContent.length}자)`,
          { page_id: spec.id, content_length: synContent.length, elapsed_ms: elapsed(tSyn) }
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await emitStep(streamId, 'agent_log', 'synthesis',
          `⚠️ "${spec.title}" 생성 실패, 건너뜀: ${errMsg}`,
          { page_id: spec.id, error: errMsg }
        );
      }
    }

    if (synthesisPageIds.length > 0) {
      if (!wikiStructure.sections) wikiStructure.sections = [];
      wikiStructure.sections.push({
        id: 'system_analysis',
        title: languageInstruction.includes('Korean') ? '시스템 분석' : 'System Analysis',
        pages: synthesisPageIds,
      });
      if (!wikiStructure.pages) wikiStructure.pages = [];
      wikiStructure.pages.push(...synthesisPageIds.map(id => generatedPages[id]));
    }

    await emitStep(streamId, 'phase_complete', 'synthesis',
      `✅ 종합 인사이트 생성 완료 — ${synthesisPageIds.length}개 페이지 (${elapsed(t45)}ms)`,
      { page_count: synthesisPageIds.length, elapsed_ms: elapsed(t45) }
    );

    // ──────────────────────────────────────────────────────────
    // Phase 5: 캐시 저장
    // ──────────────────────────────────────────────────────────
    const t4 = Date.now();
    await emitStep(streamId, 'phase_start', 'save', '💾 위키 캐시 저장 중...');

    // 백엔드 Pydantic 검증을 통과하기 위해 wikiStructure.pages 내부 요소들도
    // 필수 필드(content, importance 등)가 모두 포함된 완전한 객체로 덮어씌움
    if (wikiStructure.pages) {
      wikiStructure.pages = wikiStructure.pages.map((p: any) => generatedPages[p.id] || p);
    }

    const cachePayload = {
      repo: {
        owner, repo, type: repo_type, localPath: projectPath, repoUrl: projectPath,
        githubRepoUrl: detectedGithubRepoUrl,
        githubBranch: detectedGithubBranch,
      },
      language: effectiveWikiLanguage(language),
      wiki_structure: wikiStructure,
      generated_pages: generatedPages,
      provider,
      model
    };

    try {
      const cacheResp = await fetch(`/api/wiki_cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cachePayload)
      });

      if (!cacheResp.ok) {
        const errBody = await cacheResp.text().catch(() => '(응답 없음)');
        throw new Error(`캐시 저장 실패 (HTTP ${cacheResp.status}): ${errBody}`);
      }

      const cacheResult = await cacheResp.json().catch(() => ({}));
      await emitStep(streamId, 'phase_complete', 'save',
        `✅ 캐시 저장 완료 (${elapsed(t4)}ms)`,
        { elapsed_ms: elapsed(t4), result: cacheResult }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await emitStep(streamId, 'error', 'save', `❌ 캐시 저장 실패: ${errMsg}`);
      throw err;
    }

    // ──────────────────────────────────────────────────────────
    // 완료
    // ──────────────────────────────────────────────────────────
    await emitStep(streamId, 'complete', 'save',
      `🎉 위키 생성 완료! 총 소요시간: ${elapsed(pipelineStart)}ms`,
      {
        total_elapsed_ms: elapsed(pipelineStart),
        pages_generated: successPages,
        pages_failed: failPages,
      }
    );

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await emitStep(streamId, 'error', 'error',
      `💥 파이프라인 실패: ${errMsg}`,
      { error: errMsg, elapsed_ms: elapsed(pipelineStart) }
    );
    throw error;
  }
}
export async function translateWikiGeneration(
  projectPath: string,
  streamId: string,
  baseLanguage: string,
  targetLanguage: string,
  provider: string = "google",
  model: string = "gemini-2.5-flash",
  apiKey?: string,
  mode: "cli" | "api" = "cli",
  cliTool?: string,
) {
  const owner = "local";
  const rawName = projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  const repo = rawName
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "")
    || "project";

  const repo_type = "local";
  const pipelineStart = Date.now();

  try {
    // 1. 캐시 불러오기
    await emitStep(streamId, 'phase_start', 'scan', `📂 기준 언어(${baseLanguage}) 캐시 로드 중...`);
    const cacheRes = await fetch(`/api/wiki_cache?owner=${owner}&repo=${repo}&repo_type=${repo_type}&language=${baseLanguage}`);

    if (!cacheRes.ok) {
      throw new Error(`기준 캐시 로드 실패: ${cacheRes.statusText}`);
    }
    const cacheData = await cacheRes.json();
    if (!cacheData || !cacheData.wiki_structure || !cacheData.generated_pages) {
      throw new Error(`유효하지 않은 캐시 데이터 형식입니다.`);
    }

    await emitStep(streamId, 'phase_complete', 'scan', `✅ 기준 캐시 로드 완료`, { elapsed_ms: elapsed(pipelineStart) });

    // 2. 구조 번역
    const t2 = Date.now();
    await emitStep(streamId, 'phase_start', 'structure', `🧠 구조를 ${targetLanguage}로 번역 중...`);

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
      const match = structureContent.match(/\{[\s\S]*\}/);
      if (match) {
        // SSE 청크 안에 래핑되어 있을 경우를 대비하여 중첩 파싱 (또는 직접 파싱)
        let parsed = JSON.parse(match[0]);
        // OpenAI chunk format 인지 확인
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
          const innerMatch = parsed.choices[0].delta.content.match(/\{[\s\S]*\}/);
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
          const match = pageContent.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
              finalContent = parsed.choices[0].delta.content;
            }
          }
        } catch (e) { }

        finalContent = normalizeMarkdownContent(finalContent);
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

export async function regenerateWikiPage({
  streamId,
  projectPath,
  repo_type,
  model,
  provider,
  mode,
  cliTool,
  apiKey,
  language,
  page,
  customPrompt
}: {
  streamId: string;
  projectPath: string;
  repo_type: string;
  model: string;
  provider: string;
  mode: string;
  cliTool?: string;
  apiKey?: string;
  language: string;
  page: any;
  customPrompt: string;
}): Promise<string> {
  const t0 = Date.now();
  await emitStep(streamId, 'phase_start', 'generation', `🔄 "${page.title}" 페이지 재생성 시작...`);

  const languageInstruction = wikiLanguageInstruction(language);

  const sourceFilesText = page.filePaths && page.filePaths.length > 0
    ? `Source files to base content on:\n${page.filePaths.join('\n')}\n\nEnsure you cite the source files explicitly.`
    : `Analyze the repository codebase to gather relevant information for this topic.`;

  let pagePrompt = `You are an expert technical writer and software architect.
Your task is to generate a comprehensive and accurate technical wiki page in Markdown format.

Topic: "${page.title}"
${sourceFilesText}

Use Mermaid diagrams where appropriate.
${topicRequirements('', page.title)}

### Mermaid Diagram Rules
1. ALWAYS use \`graph TD\` (Top-Down) or \`graph TB\` for flowcharts to prevent spaghetti diagrams. DO NOT use \`LR\` unless absolutely necessary for a very simple linear flow.
2. Group related nodes using \`subgraph\` to keep the diagram clean and avoid crossing lines.
3. NEVER use quotes directly for subgraph labels in a way that breaks syntax (e.g., \`subgraph ID "Label"\`). Instead, use the format \`subgraph ID ["Label"]\` or simply avoid quotes and special characters in subgraph IDs.
4. Node Formatting & Quoting: You MUST wrap ALL node labels in double quotes to prevent syntax errors, especially if they contain special characters (like \`()\`, \`@\`, \`/\`, space) or HTML tags like \`<br>\`. Example: \`NodeID["Label text <br> (Extra Info)"]\`. NEVER use literal newline characters (\\\\n) inside labels. Keep relationships concise.
6. STRICTLY AVOID SPAGHETTI DIAGRAMS: Minimize the number of crossing edges. Create a strict hierarchical flow from top to bottom. Do NOT create chaotic cross-references or circular dependencies between distant subgraphs.
7. Edge Label Quoting (CRITICAL): NEVER wrap flowchart edge labels with double quotes inside pipes. Use plain text only: write \`A -->|Label text| B\` NOT \`A -->|"Label text"| B\`. Quotes inside \`|...\` cause a parse error in Mermaid v11.
8. erDiagram Label Rules (CRITICAL): In \`erDiagram\`, relationship labels MUST be plain identifiers with NO parentheses, brackets, or special characters. Write \`CUSTOMER ||--o{ ORDER : places\` NOT \`CUSTOMER ||--o{ ORDER : "places (orders)"\`. Parentheses inside erDiagram labels always cause a parse error.

${languageInstruction}
${STRICT_FORMAT_RULES}`;

  pagePrompt += `\n\n### ORIGINAL WIKI PAGE CONTENT\n\`\`\`markdown\n${page.content}\n\`\`\``;

  if (customPrompt && customPrompt.trim() !== '') {
    pagePrompt += `\n\n### USER REVIEW / CUSTOM INSTRUCTION\nThe user has requested the following changes or specific focus for this regeneration:\n"${customPrompt}"\n\nYou MUST regenerate the entire wiki page by applying these instructions to the original content. Output ONLY the markdown content.`;
  } else {
    pagePrompt += `\n\n### INSTRUCTION\nPlease review, improve, and rewrite the original wiki page content making it more comprehensive and professional. Ensure all formatting is correct. Output ONLY the markdown content without conversational text.`;
  }

  const pageReqBody = {
    repo_url: projectPath,
    type: repo_type,
    stream_id: streamId,
    messages: [{ role: 'user', content: pagePrompt }],
    model,
    provider,
    language,
    skip_rag: true,
    is_wiki_generation: true,
    ...(mode === "cli" ? { use_cli: true, cli_tool: cliTool || providerToCli(provider) } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
  };

  let pageContent = '';
  const decoder = new TextDecoder();

  try {
    pageContent = await fetchContent('/api/chat/stream', pageReqBody, { pageId: page.id });
    
    pageContent = normalizeMarkdownContent(pageContent);

      // --- 다이어그램 검수 및 자가 수정 (Self-Correction) 레이어 ---
      const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g;
      const matches = [...pageContent.matchAll(mermaidRegex)];
      if (matches.length > 0) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', suppressErrorRendering: true });
        for (let i = 0; i < matches.length; i++) {
          const fullMatch = matches[i][0];
          const diagramCode = matches[i][1];
          try {
            await mermaid.parse(diagramCode);
          } catch (parseError: any) {
            // parse() can be stricter than render() — skip LLM fix if render succeeds
            try {
              await mermaid.render(`validate-regen-${i}`, diagramCode);
              continue;
            } catch { /* render also fails — proceed with fix */ }

            const errMsg = parseError.message || String(parseError);
            await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 구문 오류 감지, 로컬 자동수정 시도 중...`);

            const localFixed2 = autoFixMermaid(diagramCode);
            if (localFixed2 !== diagramCode) {
              try {
                await mermaid.parse(localFixed2);
                pageContent = pageContent.replace(fullMatch, `\`\`\`mermaid\n${localFixed2}\n\`\`\``);
                await emitStep(streamId, 'agent_log', 'generation', `✅ 다이어그램 로컬 자동수정 성공 (LLM 불필요)`);
                continue;
              } catch { /* local fix not enough — fall through to LLM */ }
            }

            const fixPrompt = `The following Mermaid diagram has a syntax error:\n\n${errMsg}\n\nOriginal Diagram:\n\`\`\`mermaid\n${diagramCode}\n\`\`\`\n\nFix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.
${STRICT_FORMAT_RULES}`;
            const fixReqBody = { ...pageReqBody, messages: [{ role: 'user', content: fixPrompt }] };

            try {
              const fixResp = await fetch(`/api/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fixReqBody)
              });
              if (fixResp.ok && fixResp.body) {
                let fixedContent = '';
                const fReader = fixResp.body.getReader();
                while (true) {
                  const { done, value } = await fReader.read();
                  if (done) break;
                  fixedContent += decoder.decode(value, { stream: true });
                }
                fixedContent += decoder.decode();
                const fixedMatch = fixedContent.match(/```mermaid\n([\s\S]*?)\n```/i);
                if (fixedMatch) {
                  pageContent = pageContent.replace(fullMatch, fixedMatch[0]);
                  await emitStep(streamId, 'agent_log', 'generation', `✅ 다이어그램 자동 복구 성공!`);
                }
              }
            } catch (e) {
              await emitStep(streamId, 'agent_log', 'generation', `⚠️ 다이어그램 복구 실패: 원본 유지됨`);
            }
          }
        }
      }
      // --- 검수 레이어 끝 ---

      await emitStep(streamId, 'page_complete', 'generation', `✅ "${page.title}" 재생성 완료`, { elapsed_ms: Date.now() - t0 });
      return pageContent;
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await emitStep(streamId, 'error', 'generation', `💥 재생성 실패: ${errMsg}`, { error: errMsg });
    throw error;
  }
}
