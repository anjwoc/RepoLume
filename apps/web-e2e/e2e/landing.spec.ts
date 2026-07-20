import { expect, test } from "@playwright/test";

test.describe("RepoLume landing", () => {
  test("presents the current product honestly and links to the release", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /코드베이스를.*읽을 수 있는 위키로/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "macOS용 다운로드" })).toHaveAttribute(
      "href",
      "https://github.com/anjwoc/RepoLume/releases/latest",
    );
    await expect(page.getByAltText("grok-build를 분석해 생성한 RepoLume 위키의 다크 테마 화면")).toBeVisible();
    await expect(page.getByText("grok-build를 분석해 생성한 위키 문서")).toBeVisible();
    await expect(page.getByRole("heading", { name: /코드 밖의 맥락도/ })).toBeVisible();
    await expect(page.getByText("MCP 연결은 선택 사항입니다.")).toBeVisible();
    await expect(page.getByText("저장소 선택", { exact: true })).toBeVisible();
    await expect(page.getByText("구조와 목차 검토", { exact: true })).toBeVisible();
    await expect(page.getByText("위키 생성", { exact: true })).toBeVisible();

    const content = await page.locator("main").innerText();
    expect(content).not.toMatch(/RAG|semantic search|LLM 질의|코드 검색/);
  });

  test("compares the same grok-build wiki in light and dark themes", async ({ page }) => {
    await page.goto("/");

    const comparison = page.getByRole("slider", { name: "라이트 테마와 다크 테마 화면 비교" });
    await expect(comparison).toHaveValue("48");

    const bounds = await comparison.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width * 0.48, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
      await page.mouse.up();
      expect(Number(await comparison.inputValue())).toBeGreaterThanOrEqual(73);
    }

    await comparison.focus();
    await page.keyboard.press("End");
    await expect(comparison).toHaveValue("100");
    await expect(comparison).toHaveAttribute("aria-valuetext", "라이트 테마 100%, 다크 테마 0%");
    await page.keyboard.press("Home");
    await expect(comparison).toHaveValue("0");
    await expect(comparison).toHaveAttribute("aria-valuetext", "라이트 테마 0%, 다크 테마 100%");
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

  test("keeps keyboard focus visible and respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
    await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeVisible();
    await expect(page.locator("figure")).toHaveCSS("animation-name", "none");
  });

  test("fits a small landscape viewport", async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    await page.goto("/");

    const sizes = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1);
  });
});
