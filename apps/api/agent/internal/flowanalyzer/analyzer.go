package flowanalyzer

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type TableRef struct {
	Name string `yaml:"name"`
	DB   string `yaml:"db"`
}

type SpRef struct {
	Name string `yaml:"name"`
	DB   string `yaml:"db"`
}

type CodeRef struct {
	Host string `yaml:"host"`
	Repo string `yaml:"repo"`
	Path string `yaml:"path"`
}

type FlowDef struct {
	ID           string     `yaml:"id"`
	Name         string     `yaml:"name"`
	Repos        []string   `yaml:"repos"`
	EntryClasses []string   `yaml:"entryClasses"`
	Tables       []TableRef `yaml:"tables"`
	StoredProcs  []SpRef    `yaml:"storedProcs"`
	CodeRefs     []CodeRef  `yaml:"codeRefs"`
}

type Scope struct {
	Databases []string `json:"databases"`
	Host      string   `json:"host"`
}

type MCPInstance struct {
	InstanceName string   `json:"instanceName"`
	Tool         string   `json:"tool"`
	Roles        []string `json:"roles"`
	Scope        Scope    `json:"scope"`
}

func LoadCatalog(path string) ([]FlowDef, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var data struct {
		Flows []FlowDef `yaml:"flows"`
	}
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	return data.Flows, nil
}

func FindFlow(flows []FlowDef, id string) *FlowDef {
	upper := strings.ToUpper(id)
	for i := range flows {
		if flows[i].ID == upper {
			return &flows[i]
		}
	}
	return nil
}

func ResolveInstance(instances []MCPInstance, role, database, host string) *MCPInstance {
	for i := range instances {
		inst := &instances[i]
		if !containsStr(inst.Roles, role) {
			continue
		}
		if database != "" && !containsStr(inst.Scope.Databases, database) {
			continue
		}
		if host != "" && inst.Scope.Host != host {
			continue
		}
		return inst
	}
	return nil
}

func containsStr(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func BuildPrompt(flow FlowDef, instances []MCPInstance) string {
	var sb strings.Builder

	fmt.Fprintf(&sb, "You are an expert technical writer and software architect analyzing a REAL production codebase.\nYour task is to generate a comprehensive business flow wiki page in Markdown format.\n\n## Flow: %s (%s)\n\n", flow.Name, flow.ID)
	fmt.Fprintf(&sb, "**Repos:** %s\n**Entry points:** %s\n\n",
		strings.Join(flow.Repos, ", "), strings.Join(flow.EntryClasses, ", "))

	sb.WriteString("## Context Collection (execute in order before writing)\n\n")
	fmt.Fprintf(&sb, "### 1. Call Chain\n```\ncodegraph query \"%s\"\n```\n\n", strings.Join(flow.EntryClasses, " "))

	sb.WriteString("### 2. Table Schemas (MCP auto-selected by DB)\n")
	for _, t := range flow.Tables {
		inst := ResolveInstance(instances, "db-schema", t.DB, "")
		if inst != nil {
			fmt.Fprintf(&sb, "  - %s [%s] → mcp__%s__* (%s)\n", t.Name, t.DB, inst.Tool, inst.InstanceName)
		} else {
			fmt.Fprintf(&sb, "  - %s [%s] → (no MCP configured — infer from JPA @Column annotations)\n", t.Name, t.DB)
		}
	}

	if len(flow.StoredProcs) > 0 {
		sb.WriteString("\n### 3. Stored Procedures\n")
		for _, sp := range flow.StoredProcs {
			inst := ResolveInstance(instances, "db-stored-proc", sp.DB, "")
			if inst != nil {
				fmt.Fprintf(&sb, "  - %s [%s] → mcp__%s__* (%s)\n", sp.Name, sp.DB, inst.Tool, inst.InstanceName)
			} else {
				fmt.Fprintf(&sb, "  - %s [%s] → (no MCP configured)\n", sp.Name, sp.DB)
			}
		}
	}

	sb.WriteString("\n### 4. Source Code\n")
	for _, ref := range flow.CodeRefs {
		inst := ResolveInstance(instances, "code-reader", "", ref.Host)
		if inst != nil {
			fmt.Fprintf(&sb, "  - [%s] %s/%s → mcp__%s__get_file_contents (%s)\n",
				ref.Host, ref.Repo, ref.Path, inst.Tool, inst.InstanceName)
		} else {
			fmt.Fprintf(&sb, "  - [%s] %s/%s → (no MCP configured — use codegraph_explore)\n",
				ref.Host, ref.Repo, ref.Path)
		}
	}

	sb.WriteString(`
## Output Requirements (ALL 7 sections mandatory)

Write a Markdown wiki page that includes every section below. Missing any section = incomplete document.

1. **Overview** — one-sentence purpose, related modules, key history (tickets/dates)
2. **Workflow** — mermaid sequenceDiagram with DB tables as participants, real method names on arrows
3. **DB-Level Data Flow** ★ REQUIRED — document is incomplete without this section
   - Full table map: | Table | DB | Role |
   - Per-step SQL: [STEP 1]...[STEP N] with real column names, WHERE values, enum constants
   - Processing order summary: [Oracle] TABLE ← INSERT (COL='VAL') format
   - Table reference ERD (text)
4. **Key Components** — entry class, service classes with method signatures, repositories; file:line refs
5. **Component Chain Completeness** — | # | Component | file:line | Status (✅/🔧/❌) |
6. **Error Handling** — DB state on failure, retry behavior
7. **Domain Knowledge Q&A** — non-obvious business rules with real code snippets

## STRICTLY EXCLUDE
- Local development environment issues
- Service startup order
- Docker/k8s configuration
- Deployment/CI details
`)
	return sb.String()
}
