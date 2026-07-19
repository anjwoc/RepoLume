import { expect, test } from "@playwright/test";

test.describe("RepoLume landing", () => {
  test("presents the current product honestly and links to the release", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /코드베이스를.*읽을 수 있는 위키로/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "macOS용 다운로드" })).toHaveAttribute(
      "href",
      "https://github.com/anjwoc/local-wiki/releases/latest",
    );
    await expect(page.getByText("저장소 선택", { exact: true })).toBeVisible();
    await expect(page.getByText("구조와 목차 검토", { exact: true })).toBeVisible();
    await expect(page.getByText("위키 생성", { exact: true })).toBeVisible();

    const content = await page.locator("main").innerText();
    expect(content).not.toMatch(/RAG|semantic search|LLM 질의|코드 검색/);
  });

  test("fits a mobile viewport without horizontal page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const sizes = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1);
  });
});
