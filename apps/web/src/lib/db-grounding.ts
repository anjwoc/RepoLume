function sqlTableNames(sql: string): string[] {
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([`"[]?[\w.]+[`"\]]?)/gi;
  const tables = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const table = match[1].replace(/[`"[\]]/g, '').split('.').pop() ?? '';
    if (table) tables.add(table.toLowerCase());
  }
  return [...tables];
}

export function annotateSqlVerification(
  content: string,
  knownTables: Set<string>,
  hasMcpSchema: boolean,
): string {
  return content.replace(/```sql\n([\s\S]*?)\n```/g, (match, sql: string) => {
    const tables = sqlTableNames(sql);
    if (tables.length === 0) return match;
    if (!hasMcpSchema) {
      return `> 🧭 SQL — 코드베이스 근거 기반 추론 (DB MCP 미설정)\n\n${match}`;
    }
    const unverified = tables.filter(table => !knownTables.has(table));
    if (unverified.length === 0) {
      return `> ✅ DB Verified (tables: ${tables.join(', ')})\n\n${match}`;
    }
    return `> ⚠️ Unverified — unknown tables: ${unverified.join(', ')}\n\n${match}`;
  });
}

export function buildCodebaseDbEvidence(codeEntities: Record<string, unknown> | null): string {
  if (!codeEntities) return '';
  const tables = Array.isArray(codeEntities.db_tables) ? codeEntities.db_tables.map(String) : [];
  const procedures = Array.isArray(codeEntities.stored_procs) ? codeEntities.stored_procs.map(String) : [];
  if (tables.length === 0 && procedures.length === 0) return '';
  return [
    '<codebase_db_evidence source="static code scan">',
    `tables: ${tables.join(', ') || '(none found)'}`,
    `stored procedures: ${procedures.join(', ') || '(none found)'}`,
    '</codebase_db_evidence>',
    'DB MCP is not available. Infer database flow only from the source files, symbols, SQL/JPA calls, migrations, and table names found in this codebase. Mark claims as code-inferred and never invent columns or runtime data.',
  ].join('\n');
}
