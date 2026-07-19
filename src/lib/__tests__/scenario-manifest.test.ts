import { describe, expect, it } from 'vitest';

import { manifestToViewerScenarios } from '../scenario-manifest';

describe('test scenario manifest projection', () => {
  it('keeps successful and failed flows visible without reporting partial success as complete', () => {
    const scenarios = manifestToViewerScenarios(
      {
        status: 'failed',
        expected: 2,
        succeeded: 1,
        failed: 1,
        results: [
          { flow_id: 'F01', flow_name: 'Onboarding', kind: 'flow', output_file: 'f01.md', status: 'succeeded' },
          { flow_id: 'F02', flow_name: 'Payment', kind: 'flow', output_file: 'f02.md', status: 'failed', error_message: 'empty response' },
        ],
      },
      { 'f01.md': '# Guide' },
    );

    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]).toMatchObject({ id: 'F01', status: 'success', markdown: '# Guide' });
    expect(scenarios[1]).toMatchObject({ id: 'F02', status: 'error' });
    expect(scenarios[1].logs[0].message).toBe('empty response');
  });

  it('maps chain artifacts to the cross-flow tab', () => {
    const scenarios = manifestToViewerScenarios(
      {
        status: 'completed', expected: 1, succeeded: 1, failed: 0,
        results: [{ flow_id: 'chain-F01-F02', flow_name: 'Signup to payment', kind: 'cross-flow', output_file: 'chain.md', status: 'succeeded' }],
      },
      { 'chain.md': '# Chain' },
    );

    expect(scenarios[0].type).toBe('cross-flow');
  });
});
