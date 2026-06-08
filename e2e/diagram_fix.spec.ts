import { test, expect } from '@playwright/test';

test.describe('Diagram Error Recovery', () => {
  test('should detect mermaid error, click fix, and process mocked LLM stream', async ({ page }) => {
    // 1. Mock the Wiki Cache response to inject a faulty Mermaid diagram
    await page.route('**/api/wiki_cache*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('comprehensive=true')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            wiki_structure: {
              id: 'mock-page',
              title: 'Mock Page',
              children: []
            },
            generated_pages: {
              'mock-page': {
                content: '# Mock Page\\n\\n```mermaid\\ngraph TD\\n  A --> B\\n  INVALID SYNTAX HERE\\n```\\n'
              }
            }
          })
        });
      } else {
        await route.continue();
      }
    });

    // 2. Mock the Chat Stream response to return fixed Mermaid
    await page.route('**/api/chat/stream', async (route) => {
      if (route.request().method() === 'POST') {
        const bodyStr = '```mermaid\\ngraph TD\\n  A --> B\\n  B --> C\\n```';
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: bodyStr
        });
      } else {
        await route.continue();
      }
    });

    // We can't easily jump to a project without triggering other API calls, 
    // so we just go to the home page, and forcefully trigger the open wiki
    await page.goto('/?screen=wiki&owner=local&repo=mock&repo_type=local&language=en&id=mock-page');

    // Wait for the "다이어그램 파싱 에러" or similar text
    // The error text is usually "다이어그램 렌더링 에러" or "다이어그램 고치기"
    const fixButton = page.locator('button:has-text("다이어그램 고치기")').first();
    await expect(fixButton).toBeVisible({ timeout: 10000 });

    // Click the fix button
    await fixButton.click();

    // Verify that the error overlay disappears and diagram is fixed.
    // The "다이어그램 복구" button should disappear after successful fix.
    await expect(fixButton).not.toBeVisible({ timeout: 10000 });
  });
});
