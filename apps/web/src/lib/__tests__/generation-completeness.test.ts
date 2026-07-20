import { describe, expect, it } from 'vitest';

import {
  checkGenerationCompleteness,
  requireGenerationCompleteness,
} from '../generation-completeness';

describe('generation completeness', () => {
  it('reports every missing logical page', () => {
    const result = checkGenerationCompleteness(
      ['page-a', 'page-b', 'page-b', 'synthesis-a'],
      { 'page-a': {}, 'synthesis-a': {} },
    );

    expect(result).toEqual({
      expected: 3,
      terminal: 2,
      missingIds: ['page-b'],
      complete: false,
    });
  });

  it('accepts explicit failure stubs as terminal results', () => {
    expect(
      requireGenerationCompleteness(
        ['page-a', 'page-b'],
        {
          'page-a': { content: 'ok' },
          'page-b': { content: '> generation failed', failed: true },
        },
        'generation',
      ).complete,
    ).toBe(true);
  });

  it('throws before a pipeline can claim completion with a gap', () => {
    expect(() =>
      requireGenerationCompleteness(['page-a', 'page-b'], { 'page-a': {} }, 'save'),
    ).toThrow(/page-b/);
  });
});
