export type McpRole = 'db-schema' | 'db-stored-proc' | 'db-query' | 'code-reader';

export interface McpInstanceScope {
  databases?: string[];
  host?: string;
  description?: string;
}

export interface McpInstance {
  instanceName: string;
  tool: string;
  roles: McpRole[];
  scope: McpInstanceScope;
}

export function resolveInstance(
  instances: McpInstance[],
  role: McpRole,
  scope: { database?: string; host?: string },
): McpInstance | null {
  return instances.find(inst =>
    inst.roles.includes(role) &&
    (scope.database == null || (inst.scope.databases ?? []).includes(scope.database)) &&
    (scope.host == null || inst.scope.host === scope.host),
  ) ?? null;
}

export function mcpToolPrefix(instance: McpInstance): string {
  return `mcp__${instance.tool}__`;
}
