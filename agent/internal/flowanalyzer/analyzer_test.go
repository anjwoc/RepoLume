package flowanalyzer_test

import (
	"strings"
	"testing"

	"github.com/localwiki/agent/internal/flowanalyzer"
)

func TestBuildPrompt_ContainsFlowName(t *testing.T) {
	flow := flowanalyzer.FlowDef{
		ID:           "F18",
		Name:         "Linkrew Message Dispatch Batch",
		Repos:        []string{"affiliate-batch"},
		EntryClasses: []string{"LinkrewMessageRequestJobConfig"},
		Tables:       []flowanalyzer.TableRef{{Name: "LINKREW_MESSAGE_REQUEST", DB: "O_GAFFILIATE"}},
		CodeRefs:     []flowanalyzer.CodeRef{{Host: "github.gmarket.com", Repo: "affiliate-batch", Path: "LinkrewMessageService.java"}},
	}
	instances := []flowanalyzer.MCPInstance{
		{InstanceName: "oracle-main", Tool: "oracle", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"O_GAFFILIATE"}}},
	}

	prompt := flowanalyzer.BuildPrompt(flow, instances)

	if !strings.Contains(prompt, "Linkrew Message Dispatch Batch") {
		t.Error("prompt missing flow name")
	}
	if !strings.Contains(prompt, "mcp__oracle__") {
		t.Error("prompt missing oracle MCP hint")
	}
	if !strings.Contains(prompt, "DB-Level Data Flow") {
		t.Error("prompt missing DB-Level Data Flow section requirement")
	}
	if !strings.Contains(prompt, "STRICTLY EXCLUDE") {
		t.Error("prompt missing STRICTLY EXCLUDE section")
	}
}

func TestResolveInstance_MatchByDB(t *testing.T) {
	instances := []flowanalyzer.MCPInstance{
		{InstanceName: "oracle-main", Tool: "oracle", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"O_GAFFILIATE"}}},
		{InstanceName: "devdb-mssql", Tool: "devdb", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"nautomaildb"}}},
	}

	got := flowanalyzer.ResolveInstance(instances, "db-schema", "O_GAFFILIATE", "")
	if got == nil || got.InstanceName != "oracle-main" {
		t.Errorf("expected oracle-main, got %v", got)
	}

	got2 := flowanalyzer.ResolveInstance(instances, "db-schema", "unknown", "")
	if got2 != nil {
		t.Error("unknown db should return nil")
	}
}

func TestResolveInstance_MatchByHost(t *testing.T) {
	instances := []flowanalyzer.MCPInstance{
		{InstanceName: "github-ent", Tool: "github", Roles: []string{"code-reader"}, Scope: flowanalyzer.Scope{Host: "github.gmarket.com"}},
	}
	got := flowanalyzer.ResolveInstance(instances, "code-reader", "", "github.gmarket.com")
	if got == nil || got.InstanceName != "github-ent" {
		t.Errorf("expected github-ent, got %v", got)
	}
}
