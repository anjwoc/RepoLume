"""
Wiki-specific prompts for LocalWiki CLI.

Ported from localwiki's frontend (determineWikiStructure + generatePageContent)
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

IMPORTANT:
- Ground every claim in the provided source files only.
- Do NOT invent or infer from external knowledge.
- Generate content in {language_name} language.
- Do NOT wrap your entire answer in ```markdown fences.
- Start directly with the `<details>` block.
"""


# ─────────────────────────────────────────────
# Business Analysis Prompts
# ─────────────────────────────────────────────

BUSINESS_OVERVIEW_PROMPT = """\
You are a senior business analyst and software architect.

Analyze the repository "{repo_name}" to extract its business domain.

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
        "description": "<what happens in this step>"
      }}
    ]
  }}
]

workflow type: "user" | "system" | "integration" | "error"
business_importance: "high" | "medium" | "low"
actor: "user" | "system" | "external"
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

