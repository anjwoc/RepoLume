from cli.pipeline.source_tracker import DataSource, ContextAssembler

assembler = ContextAssembler()
assembler.add_raw("""
Jira Issues:
- PROJ-123: Update API keys
- PROJ-124: Fix memory leak
""", DataSource(
    type="jira",
    name="Jira Issues",
    url="https://jira.com/PROJ-123",
    metadata={"server": "atlassian"}
))

assembler.add_raw("""
GitHub PRs:
- PR #42: Adds model router
""", DataSource(
    type="github",
    name="GitHub PRs",
    url="https://github.com/org/repo/pull/42",
    metadata={"server": "github"}
))

ctx = assembler.build()
print(ctx.content)
print(ctx.citation_block())
print(f'Context Score: {ctx.context_score}')
print(f'MCP Source Count: {assembler.mcp_source_count}')
