"""
Wiki-specific prompts for RepoLume CLI.

Ported from repolume's frontend (determineWikiStructure + generatePageContent)
into pure Python — no browser/React dependency required.
"""

# ─────────────────────────────────────────────
# Wiki Structure Planning Prompt
# ─────────────────────────────────────────────

WIKI_STRUCTURE_PROMPT = """\
You are an expert technical writer and software architect.

Analyze the repository "{repo_name}" and create a comprehensive wiki structure.

1. The complete file tree of the project:
<file_tree>
{file_tree}
</file_tree>

2. The README file of the project:
<readme>
{readme}
</readme>

IMPORTANT: Generate all page titles and descriptions in {language_name} language.

When designing the wiki structure, include pages that benefit from visual diagrams such as:
- Architecture overviews
- Data flow descriptions
- Component relationships
- Process workflows
- State machines
- Class hierarchies

Create a structured wiki with the following main sections:
- Overview (general information about the project)
- System Architecture (how the system is designed)
- Core Features (key functionality)
- Data Management/Flow (if applicable: database schema, data pipelines, state management)
- Frontend Components (UI elements, if applicable)
- Backend Systems (server-side components)
- API Reference (if applicable)
- Deployment/Infrastructure (how to deploy, infrastructure)

Each section should contain relevant pages with titles and a list of relevant source files.

Return your analysis ONLY as valid JSON matching this exact schema:

{{
  "id": "wiki-root",
  "title": "<overall wiki title>",
  "description": "<brief repository description>",
  "sections": [
    {{
      "id": "section-1",
      "title": "<section title>",
      "pageIds": ["page-1", "page-2"]
    }}
  ],
  "pages": [
    {{
      "id": "page-1",
      "title": "<page title>",
      "description": "<what this page covers>",
      "importance": "high",
      "filePaths": ["src/main.py", "src/config.py"],
      "relatedPageIds": ["page-2"],
      "sectionId": "section-1"
    }}
  ],
  "rootSectionIds": ["section-1", "section-2"]
}}

importance must be one of: "high", "medium", "low"
Provide 15–30 pages for a comprehensive wiki.
Return ONLY the JSON object — no markdown fences, no explanation.
"""


# ─────────────────────────────────────────────
# Wiki Page Content Generation Prompt
# ─────────────────────────────────────────────

WIKI_PAGE_PROMPT = """\
You are an expert technical writer and software architect.

Generate a comprehensive technical wiki page in Markdown format for:

**Topic**: {page_title}
**Repository**: {repo_name}

The very FIRST element in your output MUST be a `<details>` block listing ALL source files used:

<details>
<summary>Relevant source files</summary>

{file_list}

</details>

Immediately after the `<details>` block, add:
# {page_title}

Then write the full wiki page based ONLY on the content of these source files:

<source_files>
{source_contents}
</source_files>

Structure your page with:

1. **Introduction** (1–2 paragraphs): purpose, scope, high-level overview.

2. **Detailed Sections** (H2/H3 headings): architecture, components, data flow, logic.
   For each section: explain key functions, classes, data structures, API endpoints, config.

3. **Mermaid Diagrams** (use EXTENSIVELY):
   - `graph TD` for flow diagrams (NEVER `graph LR`)
   - `sequenceDiagram` for API / request flows
   - `classDiagram` for class hierarchies
   - `erDiagram` for data models
   - `stateDiagram-v2` for state machines
   Each diagram must have a brief explanation before or after it.

4. **Tables**: use for API parameters, config options, data fields, component comparisons.

5. **Code Snippets** (optional, short): illustrate key implementation details.

6. **Source Citations** (CRITICAL):
   After every significant paragraph, diagram, or table, cite:
   `Sources: [filename.ext:start_line-end_line]()`
   Cite AT LEAST 5 different source files throughout the page.

7. **Summary**: brief closing paragraph.
{topic_requirements}
IMPORTANT:
- Ground every claim in the provided source files only.
- Do NOT invent or infer from external knowledge.
- Generate content in {language_name} language.
- Do NOT wrap your entire answer in ```markdown fences.
- Start directly with the `<details>` block.
"""


# ─────────────────────────────────────────────
# Topic-specific page requirements
# The generic WIKI_PAGE_PROMPT only *suggests* diagrams, so the model defaults
# to `graph TD` and never emits sequence/ER diagrams. These blocks MANDATE the
# diagram type and the concrete content each topic must cover. Injected into
# WIKI_PAGE_PROMPT via {topic_requirements}, routed by section/title.
# ─────────────────────────────────────────────

_TOPIC_BATCH = """
MANDATORY for this BATCH JOB page (in addition to the structure above):
- Include a `sequenceDiagram` showing the job execution order across components
  (Scheduler/Trigger → JobLauncher → Step → ItemReader → ItemProcessor → ItemWriter → commit).
  Make chunk boundaries and the transaction commit point explicit.
- Include a table of the job's schedule and tuning: job name / cron or trigger /
  chunk-size / idempotency / retry & skip policy.
- Add a dedicated paragraph on failure & re-run behavior: where it can break and how it recovers.
"""

_TOPIC_EVENT = """
MANDATORY for this EVENT-PROCESSING page (in addition to the structure above):
- Include a `sequenceDiagram` of the message flow
  (Producer → Broker/topic → Consumer group → Handler → ack/commit), with the
  retry / DLQ branch on failure shown explicitly.
- Include a table of topics/messages: topic / payload schema / consumer group / partition key.
- Add a dedicated paragraph on idempotency, duplicate handling, and dead-letter (DLQ) policy.
"""

_TOPIC_BACKEND = """
MANDATORY for this BACKEND API page (in addition to the structure above):
- Include an endpoint table: HTTP method / path / auth / request & response summary.
- Include a `sequenceDiagram` for at least one key endpoint
  (Client → Controller → Service → Repository/external call → Response).
- Add a dedicated paragraph on the authentication & authorization flow.
"""

_TOPIC_DATABASE = """
MANDATORY for this DATA MODEL / DATABASE page (in addition to the structure above):
- Include an `erDiagram` of the tables/entities with primary keys, foreign keys,
  and relationship cardinality (e.g. `CUSTOMER ||--o{ ORDER : places`), extracted
  from the JPA entities / schema in the source files.
- Include per-table column tables: column / type / constraints / description.
- Add a paragraph explaining the main joins and relationships.
- Base every entity, column, and relationship strictly on the source files — do NOT invent.
"""


def topic_requirements(section_id: str = "", page_title: str = "", has_db_schema: bool = False) -> str:
    """Return the MANDATORY topic block for a page, or '' if none applies.
    Routed by keywords in the section id + page title (and the db-schema signal)."""
    text = f"{section_id} {page_title}".lower()
    if has_db_schema or any(k in text for k in (
        "database", "schema", "data model", "datamodel", "erd", "entity", "persistence", "table"
    )):
        return _TOPIC_DATABASE
    if any(k in text for k in ("batch", "scheduler", "cron", "job")):
        return _TOPIC_BATCH
    if any(k in text for k in ("event", "consumer", "producer", "kafka", "message", "stream", "queue", "topic")):
        return _TOPIC_EVENT
    if any(k in text for k in ("api", "backend", "controller", "service", "gateway", "endpoint")):
        return _TOPIC_BACKEND
    return ""


# ─────────────────────────────────────────────
# Business Analysis Prompts
# ─────────────────────────────────────────────

BUSINESS_OVERVIEW_PROMPT = """\
You are a senior business analyst and software architect.

Analyze the repository "{repo_name}" to extract its business domain.

STRICT ACCURACY RULES:
- When referencing any service or sub-project, use its ACTUAL directory name from the
  file tree (e.g., "affiliate-aggregator-api"). Never use codes like F01, F09, etc.
- Only assert facts you can confirm from the provided file tree and README.


File tree:
<file_tree>
{file_tree}
</file_tree>

README:
<readme>
{readme}
</readme>

Return a JSON object (no markdown fences) describing the business domain:

{{
  "name": "<business domain name>",
  "description": "<2-3 sentence description of what this system does for the business>",
  "core_purpose": "<the single most important business problem this solves>",
  "target_users": ["<user type 1>", "<user type 2>"],
  "key_value_propositions": ["<value prop 1>", "<value prop 2>", "<value prop 3>"]
}}

Write all content in {language_name}. Return ONLY the JSON.
"""

BUSINESS_ENTITIES_PROMPT = """\
You are a senior business analyst and domain expert.

Analyze the repository "{repo_name}" and identify its core BUSINESS ENTITIES
(not technical classes — think in terms of business concepts like Customer, Order, Invoice, Product).

File tree:
<file_tree>
{file_tree}
</file_tree>

README:
<readme>
{readme}
</readme>

Return a JSON array of business entities (no markdown fences):

[
  {{
    "name": "<entity name>",
    "description": "<what this entity represents in the business domain>",
    "source_files": ["<file1.py>", "<file2.ts>"],
    "related_entities": ["<related entity name>"],
    "business_criticality": "high"
  }}
]

business_criticality must be one of: "high", "medium", "low"
Identify 5–15 key business entities.
Write all descriptions in {language_name}. Return ONLY the JSON array.
"""

DATA_FLOW_PROMPT = """\
You are a senior data architect and business analyst.

Analyze this repository and identify the key DATA FLOWS — how business data
enters, is processed, stored, and exits the system.

File tree:
<file_tree>
{file_tree}
</file_tree>

README:
<readme>
{readme}
</readme>

{db_schema_context}
STRICT ACCURACY RULES — violations make the output useless:
1. ONLY reference table names, column names, and entity names that are EXPLICITLY present
   in the file tree or README. Never infer or guess database schema.
   If you see a JPA @Entity class named "Member", use "Member" — do NOT assume a table
   called "member_archive" or any other prefixed variant unless it appears in the code.
2. When referencing a service or project in a multi-repo context, ALWAYS use the actual
   repository directory name shown in the file tree (e.g., "affiliate-aggregator-api").
   NEVER use generic codes like F01, F09, SVC-1, or similar identifiers.
3. If you cannot confirm a detail from the provided files, omit it rather than guessing.

Focus on BUSINESS DATA FLOWS (not just technical ones):
- How does user data flow through registration/authentication?
- How do orders/transactions flow through processing?
- How does content/data get ingested and transformed?
- What external systems does data flow to/from?

Return a JSON array of data flow graphs (no markdown fences):

[
  {{
    "name": "<flow name, e.g. 'User Registration Flow'>",
    "description": "<what business process this flow enables>",
    "nodes": [
      {{
        "id": "n1",
        "label": "<short label>",
        "type": "entry",
        "source_file": "<file.py>",
        "description": "<what happens here>"
      }}
    ],
    "edges": [
      {{
        "from": "n1",
        "to": "n2",
        "label": "<data being passed>",
        "data_type": "JSON"
      }}
    ]
  }}
]

node types: "entry" | "process" | "storage" | "exit" | "external"
Identify 2–5 major data flows.
Write all content in {language_name}. Return ONLY the JSON array.
"""

WORKFLOW_PROMPT = """\
You are a senior business analyst specializing in software process analysis.

Analyze this repository and map its KEY BUSINESS WORKFLOWS — the step-by-step
processes that deliver business value.

File tree:
<file_tree>
{file_tree}
</file_tree>

README:
<readme>
{readme}
</readme>

Key business entities found: {entity_names}

{db_schema_context}
STRICT ACCURACY RULES:
1. When referencing a service or project, ALWAYS use the actual repository directory
   name as shown in the file tree (e.g., "affiliate-aggregator-api"). NEVER use
   codes like F01, F09, SVC-2, or any generic identifier.
2. Only reference source files and method names you can confirm exist in the file tree.
3. Do not infer database table names beyond what is explicitly visible in the code.
4. For workflow steps that interact with a database, include `sql_query` — the representative
   SQL for that step (SELECT/INSERT/UPDATE/DELETE). Only use table and column names that
   appear in the db_schema_context above (or in the code if no schema provided).

Identify workflows like:
- User onboarding / authentication
- Core feature usage flows
- Data processing / batch workflows
- Integration / sync workflows
- Error handling / recovery workflows

Return a JSON array of workflows (no markdown fences):

[
  {{
    "name": "<workflow name>",
    "description": "<what business goal this workflow achieves>",
    "type": "user",
    "business_importance": "high",
    "steps": [
      {{
        "id": "s1",
        "label": "<step action>",
        "actor": "user",
        "source_file": "<file.py>",
        "description": "<what happens in this step>",
        "sql_query": "<representative SQL if this step touches DB, else empty string>"
      }}
    ]
  }}
]

workflow type: "user" | "system" | "integration" | "error"
business_importance: "high" | "medium" | "low"
actor: "user" | "system" | "external"
sql_query: leave empty ("") for non-DB steps. For DB steps, write ONE representative query
           using ONLY table/column names from the provided db_schema_context (or code if no schema).
Identify 3–7 key workflows.
Write all content in {language_name}. Return ONLY the JSON array.
"""

IMPACT_ANALYSIS_PROMPT = """\
You are a senior reliability engineer and business analyst.

Analyze this repository to identify the BUSINESS IMPACT of its key components.
For each critical component, determine what breaks if it fails and how severe that is.

File tree:
<file_tree>
{file_tree}
</file_tree>

Key business entities: {entity_names}
Key business workflows: {workflow_names}

For each critical component, assess:
- What business capability it enables
- What happens if it fails (customer impact, revenue impact)
- Its impact level
- Recommended monitoring priority

Return a JSON array (no markdown fences):

[
  {{
    "component": "<component/module name>",
    "source_files": ["<file1.py>"],
    "business_capability": "<what business function this enables>",
    "failure_impact": "<what breaks and how bad it is for users/business>",
    "impact_level": "critical",
    "downstream_components": ["<component that depends on this>"],
    "monitoring_priority": "high",
    "recommended_slo": "<e.g. 99.9% availability, p99 < 200ms>"
  }}
]

impact_level: "critical" | "high" | "medium" | "low"
monitoring_priority: "critical" | "high" | "medium" | "low"
Identify 5–12 components.
Write all content in {language_name}. Return ONLY the JSON array.
"""
