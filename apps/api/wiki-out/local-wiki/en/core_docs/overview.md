{
  "id": "wiki",
  "title": "Local Wiki Project Documentation",
  "description": "Comprehensive documentation for local-wiki architecture, API endpoints, agent runners, CLI tools, and background pipelines.",
  "pages": [
    {
      "id": "overview",
      "title": "Project Architecture & Overview",
      "content": "",
      "filePaths": [
        "apps/api/api/main.py",
        "apps/api/api/server.py",
        "apps/api/agent/cmd/repolume-agent/main.go"
      ],
      "importance": "high",
      "relatedPages": [
        "api_and_cli"
      ]
    },
    {
      "id": "api_and_cli",
      "title": "API Routes & CLI Pipeline",
      "content": "",
      "filePaths": [
        "apps/api/api/routes/wiki.py",
        "apps/api/cli/pipeline/structure_planner.py",
        "apps/api/cli/pipeline/page_generator.py"
      ],
      "importance": "high",
      "relatedPages": [
        "overview"
      ]
    }
  ],
  "sections": [
    {
      "id": "core_docs",
      "title": "Core Documentation",
      "pages": [
        "overview",
        "api_and_cli"
      ]
    }
  ],
  "rootSections": [
    "core_docs"
  ]
}
