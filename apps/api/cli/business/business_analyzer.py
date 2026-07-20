"""
BusinessAnalyzer — Orchestrates comprehensive business logic analysis.

Analyzes a repository to extract:
  - Core business domain and purpose
  - Key business entities and their relationships
  - Business workflows and processes
  - Data flows across the system
  - Business impact of critical components
  - Technical debt with business implications
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List

from cli.business.data_flow_tracer import DataFlowTracer, DataFlowGraph
from cli.business.workflow_mapper import WorkflowMapper, BusinessWorkflow
from cli.business.impact_analyzer import ImpactAnalyzer, ComponentImpact
from cli.prompts import (
    BUSINESS_OVERVIEW_PROMPT,
    BUSINESS_ENTITIES_PROMPT,
)

logger = logging.getLogger(__name__)


@dataclass
class BusinessDomain:
    """High-level business domain description."""
    name: str
    description: str
    core_purpose: str
    target_users: List[str]
    key_value_propositions: List[str]


@dataclass
class BusinessEntity:
    """A key business entity (concept, object) in the codebase."""
    name: str
    description: str
    source_files: List[str]
    related_entities: List[str] = field(default_factory=list)
    business_criticality: str = "medium"  # "high" | "medium" | "low"


@dataclass
class BusinessAnalysis:
    """Complete business analysis result for a repository."""
    domain: BusinessDomain
    entities: List[BusinessEntity]
    workflows: List[BusinessWorkflow]
    data_flows: List[DataFlowGraph]
    component_impacts: List[ComponentImpact]
    business_summary_md: str       # Full markdown analysis page
    data_flow_summary_md: str      # Data flow section markdown
    workflow_summary_md: str       # Workflow section markdown
    impact_summary_md: str         # Impact analysis section markdown


class BusinessAnalyzer:
    """
    Orchestrates the full business analysis of a repository.

    Usage::

        from cli.business import BusinessAnalyzer
        analyzer = BusinessAnalyzer(provider, repo, repo_name="my-app")
        analysis = analyzer.analyze(lang="ko")
        print(analysis.business_summary_md)
    """

    def __init__(self, provider, repo, repo_name: str, mcp_manager=None):
        self._provider = provider
        self._repo = repo
        self._repo_name = repo_name
        self._mcp_manager = mcp_manager
        self._data_flow_tracer = DataFlowTracer(provider, repo)
        self._workflow_mapper = WorkflowMapper(provider, repo)
        self._impact_analyzer = ImpactAnalyzer(provider, repo)

    def analyze(self, lang: str = "en") -> BusinessAnalysis:
        """Run the full business analysis pipeline."""
        logger.info(f"Starting business analysis for {self._repo_name}...")

        # 1. Get file tree and README for context
        file_tree = self._repo.file_tree()
        readme = self._repo.readme() or "(no README found)"
        if len(readme) > 6_000:
            readme = readme[:6_000] + "\n...(truncated)"

        # 2. Collect MCP context (DB schema, GitHub info) if available
        db_schema_context, gh_owner, gh_repo = self._collect_mcp_context()

        # 3. Generate business overview (domain + entities)
        logger.info("Analyzing business domain...")
        domain, entities = self._analyze_domain_and_entities(
            file_tree, readme, lang
        )

        # 4. Trace data flows
        logger.info("Tracing data flows...")
        data_flows = self._data_flow_tracer.trace(
            file_tree, readme, lang=lang, db_schema_context=db_schema_context
        )

        # 5. Map business workflows
        logger.info("Mapping business workflows...")
        workflows = self._workflow_mapper.map(
            file_tree, readme, entities, lang=lang, db_schema_context=db_schema_context
        )

        # 6. Validate source_file paths via GitHub MCP (best-effort)
        if gh_owner and gh_repo and self._mcp_manager and self._mcp_manager._github_client:
            self._validate_source_files(workflows, data_flows, gh_owner, gh_repo)

        # 6b. Cross-check SQL queries against actual DB schema
        if db_schema_context:
            self._verify_sql_queries(workflows, db_schema_context)

        # 7. Analyze component impact
        logger.info("Analyzing component business impact...")
        component_impacts = self._impact_analyzer.analyze(
            file_tree, entities, workflows, lang=lang
        )

        # 8. Render markdown sections
        business_summary_md = self._render_business_summary(
            domain, entities, lang
        )
        data_flow_md = self._data_flow_tracer.render_markdown(data_flows, lang)
        workflow_md = self._workflow_mapper.render_markdown(workflows, lang)
        impact_md = self._impact_analyzer.render_markdown(component_impacts, lang)

        logger.info("Business analysis complete.")
        return BusinessAnalysis(
            domain=domain,
            entities=entities,
            workflows=workflows,
            data_flows=data_flows,
            component_impacts=component_impacts,
            business_summary_md=business_summary_md,
            data_flow_summary_md=data_flow_md,
            workflow_summary_md=workflow_md,
            impact_summary_md=impact_md,
        )

    # ── Private helpers ──────────────────────────────────────────────────── #

    def _collect_mcp_context(self) -> tuple[str, str, str]:
        """
        Return (db_schema_context, gh_owner, gh_repo).

        When MCPManager is absent or all clients are disabled, returns ("", "", "").
        Code-only mode remains grounded by file-tree, source-file, ORM, migration,
        and inline SQL evidence supplied by the repository analyzers.
        """
        db_schema_context = ""
        gh_owner = ""
        gh_repo = ""

        if not self._mcp_manager:
            return db_schema_context, gh_owner, gh_repo

        # DB schema — use first enabled client
        for db_client in self._mcp_manager._db_clients:
            if not db_client._config.enabled or not db_client.available:
                continue
            try:
                ctx = db_client.get_schema_context()
                if ctx and ctx.content:
                    db_schema_context = ctx.content
                    logger.info(
                        "DB schema collected (%d chars) from %s",
                        len(db_schema_context),
                        db_client._config.db_type,
                    )
            except Exception as e:
                logger.warning("DB schema fetch failed: %s", e)
            break  # one DB client is enough

        # GitHub owner/repo from config or git remote
        gh_client = self._mcp_manager._github_client
        if gh_client and gh_client._config.enabled:
            gh_owner = gh_client._config.owner
            gh_repo = gh_client._config.repo
            if not gh_owner or not gh_repo:
                from cli.mcp.github_mcp import detect_github_remote
                detected = detect_github_remote(str(self._repo.path))
                if detected:
                    gh_owner, gh_repo = detected

        return db_schema_context, gh_owner, gh_repo

    def _verify_sql_queries(self, workflows, db_schema_context: str) -> None:
        """
        Cross-check sql_query fields in workflow steps against the actual DB schema.

        Sets step.sql_verified = True when all referenced tables exist in the schema,
        False when at least one table cannot be confirmed.
        """
        import re

        # Extract known table names from db_schema_context (### TABLE_NAME headings)
        known_tables: set[str] = {
            m.lower()
            for m in re.findall(r"^###\s+(\S+)", db_schema_context, re.MULTILINE)
        }
        if not known_tables:
            return

        # Regex to pull table names from common SQL patterns
        _TABLE_RE = re.compile(
            r"\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([`\"\[]?[\w.]+[`\"\]]?)",
            re.IGNORECASE,
        )

        for wf in workflows:
            for step in wf.steps:
                if not step.query_evidence:
                    continue
                referenced = {
                    m.strip('`"[]').split(".")[-1].lower()
                    for m in _TABLE_RE.findall(step.query_evidence)
                }
                if not referenced:
                    continue
                step.sql_verified = all(t in known_tables for t in referenced)

    def _validate_source_files(self, workflows, data_flows, owner: str, repo: str) -> None:
        """
        Validate source_file paths in workflows/data_flows via GitHub MCP.

        Invalid paths get cleared so the UI doesn't generate broken links.
        """
        gh_client = self._mcp_manager._github_client

        # Collect unique paths
        paths: list[str] = []
        for wf in workflows:
            for step in wf.steps:
                if step.source_file and step.source_file not in paths:
                    paths.append(step.source_file)
        for flow in data_flows:
            for node in flow.nodes:
                if node.source_file and node.source_file not in paths:
                    paths.append(node.source_file)

        if not paths:
            return

        logger.info("Validating %d source file paths via GitHub MCP...", len(paths))
        validity = gh_client.validate_file_paths(owner, repo, paths)

        invalid = [p for p, ok in validity.items() if not ok]
        if invalid:
            logger.info("GitHub MCP: %d paths not found in repo: %s", len(invalid), invalid[:5])

        invalid_set = set(invalid)
        for wf in workflows:
            for step in wf.steps:
                if step.source_file in invalid_set:
                    step.source_file = ""
        for flow in data_flows:
            for node in flow.nodes:
                if node.source_file in invalid_set:
                    node.source_file = ""

    def _analyze_domain_and_entities(
        self, file_tree: str, readme: str, lang: str
    ):
        """Use LLM to extract business domain and key entities."""
        from cli.pipeline.structure_planner import LANGUAGE_NAMES
        import json, re

        language_name = LANGUAGE_NAMES.get(lang, "English")

        # Business overview
        overview_prompt = BUSINESS_OVERVIEW_PROMPT.format(
            repo_name=self._repo_name,
            file_tree=file_tree,
            readme=readme,
            language_name=language_name,
        )
        overview_raw = self._provider.generate(overview_prompt)

        # Entity extraction
        entity_prompt = BUSINESS_ENTITIES_PROMPT.format(
            repo_name=self._repo_name,
            file_tree=file_tree,
            readme=readme,
            language_name=language_name,
        )
        entity_raw = self._provider.generate(entity_prompt)

        domain = self._parse_domain(overview_raw)
        entities = self._parse_entities(entity_raw)
        return domain, entities

    def _parse_domain(self, raw: str) -> BusinessDomain:
        """Parse LLM domain response into BusinessDomain."""
        import json, re
        try:
            clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
            clean = re.sub(r"\s*```$", "", clean.strip(), flags=re.MULTILINE)
            match = re.search(r"\{.*\}", clean, re.DOTALL)
            if match:
                data = json.loads(match.group())
                return BusinessDomain(
                    name=data.get("name", self._repo_name),
                    description=data.get("description", ""),
                    core_purpose=data.get("core_purpose", ""),
                    target_users=data.get("target_users", []),
                    key_value_propositions=data.get("key_value_propositions", []),
                )
        except Exception as e:
            logger.warning(f"Domain parse failed, using raw text: {e}")

        # Fallback: use raw as description
        return BusinessDomain(
            name=self._repo_name,
            description=raw[:500],
            core_purpose="",
            target_users=[],
            key_value_propositions=[],
        )

    def _parse_entities(self, raw: str) -> List[BusinessEntity]:
        """Parse LLM entity response into list of BusinessEntity."""
        import json, re
        try:
            clean = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
            clean = re.sub(r"\s*```$", "", clean.strip(), flags=re.MULTILINE)
            match = re.search(r"\[.*\]", clean, re.DOTALL)
            if match:
                data = json.loads(match.group())
                return [
                    BusinessEntity(
                        name=e.get("name", ""),
                        description=e.get("description", ""),
                        source_files=e.get("source_files", []),
                        related_entities=e.get("related_entities", []),
                        business_criticality=e.get("business_criticality", "medium"),
                    )
                    for e in data if e.get("name")
                ]
        except Exception as e:
            logger.warning(f"Entity parse failed: {e}")
        return []

    def _render_business_summary(
        self,
        domain: BusinessDomain,
        entities: List[BusinessEntity],
        lang: str,
    ) -> str:
        """Render the business overview section as markdown."""
        lines = [
            f"# Business Analysis: {domain.name}",
            "",
            "## Business Domain Overview",
            "",
            domain.description,
            "",
        ]

        if domain.core_purpose:
            lines += ["**Core Purpose:**", "", domain.core_purpose, ""]

        if domain.target_users:
            lines += ["**Target Users:**", ""]
            for u in domain.target_users:
                lines.append(f"- {u}")
            lines.append("")

        if domain.key_value_propositions:
            lines += ["**Key Value Propositions:**", ""]
            for v in domain.key_value_propositions:
                lines.append(f"- {v}")
            lines.append("")

        if entities:
            lines += ["## Core Business Entities", ""]
            high = [e for e in entities if e.business_criticality == "high"]
            med = [e for e in entities if e.business_criticality == "medium"]
            low = [e for e in entities if e.business_criticality == "low"]

            for group_label, group in [
                ("🔴 High Criticality", high),
                ("🟡 Medium Criticality", med),
                ("🟢 Low Criticality", low),
            ]:
                if not group:
                    continue
                lines += [f"### {group_label}", ""]
                for entity in group:
                    lines += [
                        f"#### {entity.name}",
                        "",
                        entity.description,
                        "",
                    ]
                    if entity.source_files:
                        lines.append(
                            "**Source files:** "
                            + ", ".join(f"`{f}`" for f in entity.source_files[:5])
                        )
                        lines.append("")
                    if entity.related_entities:
                        lines.append(
                            "**Related to:** "
                            + ", ".join(entity.related_entities)
                        )
                        lines.append("")

        return "\n".join(lines)
