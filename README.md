# LocalWiki

**LocalWiki** is a powerful general-purpose tool designed to analyze code repositories and automatically generate comprehensive, interactive wikis with visual diagrams.

## ✨ Features
- **Instant Documentation**: Analyze code structure and generate wikis automatically.
- **Visual Diagrams**: Automatically generated Mermaid diagrams for architecture and data flow.
- **RAG-based Q&A**: Ask questions and converse with your repository code.
- **DeepResearch**: Multi-turn in-depth research of the codebase.

## 🚀 Quick Start

### Step 1: Environment Variables
Create a `.env` file in the project root with the required API keys:
```
GOOGLE_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key
```

### Step 2: Start Backend
```bash
python -m pip install poetry==2.0.1 && poetry install -C api
python -m api.main
```

### Step 3: Start Frontend
```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## 🛠️ Project Structure
- `api/`: Backend API server (FastAPI, RAG pipelines, etc.)
- `src/`: Frontend Next.js app (UI components, Wiki rendering)
- `public/`: Static assets
