import type { LogEntry, ScenarioType } from './test-scenario-types';

export interface ScenarioManifestResult {
  flow_id: string;
  flow_name: string;
  kind: 'flow' | 'cross-flow' | string;
  output_file?: string;
  status: 'succeeded' | 'failed' | string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ScenarioManifest {
  status: 'running' | 'completed' | 'failed' | string;
  expected: number;
  succeeded: number;
  failed: number;
  results: ScenarioManifestResult[];
}

export interface ViewerScenario {
  id: string;
  flowId: string;
  flowName: string;
  type: ScenarioType;
  title: string;
  status: 'success' | 'error';
  steps: [];
  markdown?: string;
  logs: LogEntry[];
  startedAt?: string;
  completedAt?: string;
}

export function manifestToViewerScenarios(
  manifest: ScenarioManifest | null | undefined,
  documents: Record<string, string> = {},
): ViewerScenario[] {
  return (manifest?.results ?? []).map((result) => {
    const logs: LogEntry[] = result.error_message
      ? [{
          level: 'error',
          message: result.error_message,
          timestamp: result.completed_at ?? result.started_at ?? '',
        }]
      : [];

    return {
      id: result.flow_id,
      flowId: result.flow_id,
      flowName: result.flow_name,
      type: result.kind === 'cross-flow' ? 'cross-flow' : 'happy-path',
      title: result.flow_name,
      status: result.status === 'succeeded' ? 'success' : 'error',
      steps: [],
      markdown: result.output_file ? documents[result.output_file] : undefined,
      logs,
      startedAt: result.started_at,
      completedAt: result.completed_at,
    };
  });
}
