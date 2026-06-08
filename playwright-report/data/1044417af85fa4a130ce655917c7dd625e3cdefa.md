# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: diagram_fix.spec.ts >> Diagram Error Recovery >> should detect mermaid error, click fix, and process mocked LLM stream
- Location: e2e/diagram_fix.spec.ts:4:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button:has-text("다이어그램 고치기")').first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('button:has-text("다이어그램 고치기")').first()

```

```yaml
- text: 1 실행 모드 2 모델 선택 3 언어 선택
- heading "👋 시작하기" [level=1]
- paragraph: AI를 어떻게 실행하시겠어요?
- button "추천 로컬 CLI 모드 서버 환경변수에 설정된 API 키 또는 로컬 CLI 도구 사용":
  - text: 추천
  - paragraph: 로컬 CLI 모드
  - paragraph: 서버 환경변수에 설정된 API 키 또는 로컬 CLI 도구 사용
- button "API 키 직접 입력 이 앱에서 직접 API 키를 입력해서 사용":
  - paragraph: API 키 직접 입력
  - paragraph: 이 앱에서 직접 API 키를 입력해서 사용
- paragraph: ✅ 백엔드 서버 환경변수의 API 키를 자동으로 사용합니다
- button "다음"
- alert
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Diagram Error Recovery', () => {
  4  |   test('should detect mermaid error, click fix, and process mocked LLM stream', async ({ page }) => {
  5  |     // 1. Mock the Wiki Cache response to inject a faulty Mermaid diagram
  6  |     await page.route('**/api/wiki_cache*', async (route) => {
  7  |       const url = route.request().url();
  8  |       if (route.request().method() === 'GET' && url.includes('comprehensive=true')) {
  9  |         await route.fulfill({
  10 |           status: 200,
  11 |           contentType: 'application/json',
  12 |           body: JSON.stringify({
  13 |             wiki_structure: {
  14 |               id: 'mock-page',
  15 |               title: 'Mock Page',
  16 |               children: []
  17 |             },
  18 |             generated_pages: {
  19 |               'mock-page': {
  20 |                 content: '# Mock Page\\n\\n```mermaid\\ngraph TD\\n  A --> B\\n  INVALID SYNTAX HERE\\n```\\n'
  21 |               }
  22 |             }
  23 |           })
  24 |         });
  25 |       } else {
  26 |         await route.continue();
  27 |       }
  28 |     });
  29 | 
  30 |     // 2. Mock the Chat Stream response to return fixed Mermaid
  31 |     await page.route('**/api/chat/stream', async (route) => {
  32 |       if (route.request().method() === 'POST') {
  33 |         const bodyStr = '```mermaid\\ngraph TD\\n  A --> B\\n  B --> C\\n```';
  34 |         await route.fulfill({
  35 |           status: 200,
  36 |           contentType: 'text/plain',
  37 |           body: bodyStr
  38 |         });
  39 |       } else {
  40 |         await route.continue();
  41 |       }
  42 |     });
  43 | 
  44 |     // We can't easily jump to a project without triggering other API calls, 
  45 |     // so we just go to the home page, and forcefully trigger the open wiki
  46 |     await page.goto('/?screen=wiki&owner=local&repo=mock&repo_type=local&language=en&id=mock-page');
  47 | 
  48 |     // Wait for the "다이어그램 파싱 에러" or similar text
  49 |     // The error text is usually "다이어그램 렌더링 에러" or "다이어그램 고치기"
  50 |     const fixButton = page.locator('button:has-text("다이어그램 고치기")').first();
> 51 |     await expect(fixButton).toBeVisible({ timeout: 10000 });
     |                             ^ Error: expect(locator).toBeVisible() failed
  52 | 
  53 |     // Click the fix button
  54 |     await fixButton.click();
  55 | 
  56 |     // Verify that the error overlay disappears and diagram is fixed.
  57 |     // The "다이어그램 복구" button should disappear after successful fix.
  58 |     await expect(fixButton).not.toBeVisible({ timeout: 10000 });
  59 |   });
  60 | });
  61 | 
```