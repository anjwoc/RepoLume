# Business Flow Analysis Prompt Spec

Usage guide for manually analyzing one business flow in a Claude Code session.
Each STEP can be sent as a separate message or combined into one.

---

## STEP 1: Call Chain Collection (codegraph)

```
codegraph query "[EntryClassName] [MainServiceClassName]"

Example:
codegraph query "LinkrewMessageRequestJobConfig LinkrewMessageService SendMessageTargetSupportServiceBaseImpl"
```

---

## STEP 2: DB Schema Collection (role-based)

For each table, use whichever MCP tool in the current session has access to that DB.
Do not hardcode tool names — instruct by role + scope.

```
[Oracle O_GAFFILIATE tables]
"Retrieve the schema for [TableName] in the O_GAFFILIATE DB.
 Use the MCP tool in the current session that has access to Oracle."

[MSSQL nautomaildb tables]
"Retrieve the schema for [TableName] in nautomaildb.
 Use the MCP tool in the current session that has access to MSSQL."

[No MCP fallback]
codegraph query "[TableName] entity"  → check JPA @Table, @Column annotations
```

---

## STEP 3: Stored Procedure Definition (if applicable)

```
"Retrieve the definition of stored procedure [SP name].
 Use the Oracle DB MCP tool, or if unavailable, infer from @SaturnProcedure annotations."
```

---

## STEP 4: Source Code Collection

```
"Retrieve [file path] from the [repo] repository on [host].
 Use the GitHub MCP tool in the current session."

Example:
"Retrieve lib-message/.../LinkrewMessageService.java
 from the affiliate-batch repository on github.gmarket.com."
```

---

## STEP 5: Analysis — send this prompt

```
You are an expert technical writer and software architect analyzing a REAL production codebase.
Using the context collected above, write a comprehensive business flow wiki page in Markdown.

## MANDATORY SECTIONS (all 7 required)

1. **Overview** — one-sentence purpose, related modules (repos/submodules), key history (tickets/dates)

2. **Workflow** — mermaid sequenceDiagram
   - Include real DB table names as participants (e.g. `DB_Request as "Oracle: LINKREW_MESSAGE_REQUEST"`)
   - Real method names or SQL conditions on each arrow

3. **DB-Level Data Flow** ★ REQUIRED — document is incomplete without this section
   - Full table map: `| Table | DB Type | Role |`
   - Per-step SQL: [STEP 1]…[STEP N] each with real SELECT/INSERT/UPDATE/EXEC
     - Real column names, WHERE clause values, enum constants ('N'/'Y', 'B'/'C' etc.)
     - JPA methods as comments: `-- JPA: findByPartnerType(PartnerType.B2C)`
     - Unverifiable SQL: `-- NOTE: MCP not connected — manual verification required (oracle-gaffiliate)`
   - Processing order summary: `[Oracle] LINKREW_MESSAGE_REQUEST ← INSERT (PROC_YN='N')` format
   - Table reference ERD (text)

4. **Key Components** — entry class, main service classes with method signatures, repositories
   Include file:line references for each

5. **Component Chain Completeness**
   `| # | Component | file:line | Status (✅/🔧/❌) |`

6. **Error Handling** — DB state on failure, retry behavior

7. **Domain Knowledge Q&A** — non-obvious business rules with real code snippets

## STRICTLY EXCLUDE
- Local development environment issues
- Service startup order
- Docker/k8s configuration
- Deployment/CI details
```

---

## Quick Reference by Flow

| Flow ID | Entry Class | Key Tables | DB |
|---|---|---|---|
| F01 | SignUpService | LINKREW_MEMB_INFO | O_GAFFILIATE |
| F02 | ShortUrlController | AFFILIATE_SHORT_URL | O_GAFFILIATE |
| F03 | InflowShortUrlService | (MongoDB inflow log) | MongoDB |
| F04 | OrderPlacedListener | AFFILIATE_ORDER, AFFILIATE_INFLOW | O_GAFFILIATE |
| F05 | PaymentApprovedListener | AFFILIATE_ORDER | O_GAFFILIATE |
| F06 | RefundListener | AFFILIATE_ORDER | O_GAFFILIATE |
| F07 | PostbackService | AFFILIATE_POSTBACK_HISTORY | O_GAFFILIATE |
| F08 | LinkrewMembInfoRestController | LINKREW_MEMB_INFO | O_GAFFILIATE |
| F09 | AffiliateOrderRetryJobConfig | AFFILIATE_ORDER | O_GAFFILIATE |
| F10 | AffiliateSettlementAggregateJobConfig | AFFILIATE_SETTLE_DAILY, AFFILIATE_SETTLE | O_GAFFILIATE |
| F11 | AffiliateSettlementAggregateJobConfig | AFFILIATE_SETTLE_DAILY, AFFILIATE_SETTLE_DETAIL | O_GAFFILIATE |
| F12 | AffiliateShareInsertSmileCashEventMonthlyJobConfig | AFFILIATE_SETTLE_SHARE | O_GAFFILIATE |
| F13 | AffiliateRetentionJobConfig | AFFILIATE_INFLOW_LOG / affiliate_log_archive | O_GAFFILIATE / MongoDB |
| F14 | SignUpService | LINKREW_MEMB_INFO, LINKREW_BUSINESS | O_GAFFILIATE |
| F15 | LinkrewSettlementAggregateJobConfig | LINKREW_SETTLE_DAILY, LINKREW_SETTLE | O_GAFFILIATE |
| F16 | LinkrewSettlementRemitJobConfig | LINKREW_SETTLE_PROC | O_GAFFILIATE |
| F17 | LinkrewReverseInvoiceConfirmJobConfig | LINKREW_BUSINESS, LINKREW_INVOICE | O_GAFFILIATE |
| F18 | LinkrewMessageRequestJobConfig | LINKREW_MESSAGE_REQUEST, LINKREW_NOTI_BOX, auto_linkrew_common | O_GAFFILIATE / nautomaildb |
| F19 | LinkrewRetentionMemberAggregateJobConfig | LINKREW_MEMB_INFO / linkrew_member_archive | O_GAFFILIATE / MongoDB |
