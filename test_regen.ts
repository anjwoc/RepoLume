import { regenerateWikiPage } from "./src/lib/wiki-generator";

async function main() {
  try {
    const content = await regenerateWikiPage({
      streamId: "test-stream",
      projectPath: "anjwoc/code-sonar",
      repo_type: "local",
      model: "local",
      provider: "google",
      mode: "cli",
      language: "ko",
      page: {
        id: "test",
        title: "Test",
        content: "test",
        filePaths: []
      },
      customPrompt: "test"
    });
    console.log("RESULT LENGTH:", content.length);
    console.log("RESULT PREVIEW:", content.substring(0, 100));
  } catch (e) {
    console.error("ERROR:", e);
  }
}
main();
