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
