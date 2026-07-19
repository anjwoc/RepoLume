package flowanalyzer_test

import (
	"strings"
	"testing"

	"github.com/localwiki/agent/internal/flowanalyzer"
)

func TestBuildPrompt_ContainsFlowName(t *testing.T) {
	flow := flowanalyzer.FlowDef{
		ID:           "F18",
		Name:         "Notification Dispatch Batch",
		Repos:        []string{"notification-batch"},
		EntryClasses: []string{"NotificationRequestJobConfig"},
		Tables:       []flowanalyzer.TableRef{{Name: "NOTIFICATION_REQUEST", DB: "ORDERS"}},
		CodeRefs:     []flowanalyzer.CodeRef{{Host: "github.example.com", Repo: "notification-batch", Path: "NotificationService.java"}},
	}
	instances := []flowanalyzer.MCPInstance{
		{InstanceName: "oracle-main", Tool: "oracle", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"ORDERS"}}},
	}

	prompt := flowanalyzer.BuildPrompt(flow, instances)

	if !strings.Contains(prompt, "Notification Dispatch Batch") {
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
		{InstanceName: "oracle-main", Tool: "oracle", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"ORDERS"}}},
		{InstanceName: "devdb-mssql", Tool: "devdb", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"notifications"}}},
	}

	got := flowanalyzer.ResolveInstance(instances, "db-schema", "ORDERS", "")
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
		{InstanceName: "github-ent", Tool: "github", Roles: []string{"code-reader"}, Scope: flowanalyzer.Scope{Host: "github.example.com"}},
	}
	got := flowanalyzer.ResolveInstance(instances, "code-reader", "", "github.example.com")
	if got == nil || got.InstanceName != "github-ent" {
		t.Errorf("expected github-ent, got %v", got)
	}
}
