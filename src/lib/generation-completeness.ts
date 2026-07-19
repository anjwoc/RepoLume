export interface GenerationCompleteness {
  expected: number;
  terminal: number;
  missingIds: string[];
  complete: boolean;
}

export function checkGenerationCompleteness(
  expectedIds: Iterable<string>,
  generatedPages: Record<string, unknown>,
): GenerationCompleteness {
  const expected = [...new Set(expectedIds)].sort();
  const missingIds = expected.filter((pageId) => !(pageId in generatedPages));
  return {
    expected: expected.length,
    terminal: expected.length - missingIds.length,
    missingIds,
    complete: expected.length > 0 && missingIds.length === 0,
  };
}

export function requireGenerationCompleteness(
  expectedIds: Iterable<string>,
  generatedPages: Record<string, unknown>,
  phase: string,
): GenerationCompleteness {
  const result = checkGenerationCompleteness(expectedIds, generatedPages);
  if (!result.complete) {
    throw new Error(
      `${phase} completeness barrier failed: ${result.terminal}/${result.expected} terminal; missing=${result.missingIds.join(',')}`,
    );
  }
  return result;
}
