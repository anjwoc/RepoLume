import { test, expect } from '@playwright/test';

const brokenDiagram = 'graph TD\n  A -->';
const fixedDiagram = 'graph TD\n  A --> B\n  B --> C';

function wikiCache(diagram: string) {
  return {
    wiki_structure: {
      id: 'mock-wiki',
      title: 'Mock Wiki',
      description: '',
      sections: [
        {
          id: 'overview',
          title: 'Overview',
          pages: ['mock-page'],
          subsections: [],
        },
      ],
      rootSections: ['overview'],
      pages: [
        {
          id: 'mock-page',
          title: 'Mock Page',
          description: '',
          importance: 'high',
          relevant_files: [],
          related_pages: [],
          parent_section: 'overview',
        },
      ],
    },
    generated_pages: {
      'mock-page': {
        id: 'mock-page',
        title: 'Mock Page',
        content: `# Mock Page\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`,
        source_files: [],
        related_pages: [],
      },
    },
  };
}

test.describe('Diagram Error Recovery', () => {
  test('repairs a Mermaid error through the durable task stream', async ({ page }) => {
    let repaired = false;

    await page.route('**/api/wiki_cache*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(wikiCache(repaired ? fixedDiagram : brokenDiagram)),
      });
    });

    await page.route('**/api/fix_diagram', async (route) => {
      repaired = true;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'mock-fix-job' }),
      });
    });

    await page.route('**/api/task-streams/mock-fix-job/stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: complete\ndata: ${JSON.stringify({ data: { page_id: 'mock-page' } })}\n\n`,
      });
    });

    await page.goto('/wiki/local/mock?repo_type=local&language=en&page=mock-page');

    const fixButton = page.getByRole('button', { name: '다이어그램 고치기' }).first();
    await expect(fixButton).toBeVisible({ timeout: 15_000 });
    await fixButton.click();
    await expect(fixButton).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('다이어그램 렌더링 에러')).not.toBeVisible();
  });
});
