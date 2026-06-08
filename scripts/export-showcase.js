const fs = require('fs');
const path = require('path');
const http = require('http');

const BACKEND_URL = process.env.PYTHON_BACKEND_HOST || 'http://localhost:8001';
const SHOWCASE_DIR = path.join(__dirname, '..', 'public', 'showcase-data');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function exportShowcase() {
  console.log('Starting Showcase Export...');
  
  if (!fs.existsSync(SHOWCASE_DIR)) {
    fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
  }

  try {
    // 1. Fetch project list
    const projectsUrl = `${BACKEND_URL}/api/processed_projects`;
    console.log(`Fetching projects from ${projectsUrl}...`);
    let projects = await fetchJson(projectsUrl);
    
    // CLI 인자로 특정 프로젝트 ID를 전달받은 경우, 해당 프로젝트만 필터링
    const targetProjectIds = process.argv.slice(2);
    if (targetProjectIds.length > 0) {
      projects = projects.filter(p => targetProjectIds.includes(p.id));
      console.log(`Filtered projects to: ${projects.map(p => p.id).join(', ')}`);
      
      // 기존 projects.json 파일이 있다면 읽어서 머지(Merge)합니다.
      const projectsJsonPath = path.join(SHOWCASE_DIR, 'projects.json');
      if (fs.existsSync(projectsJsonPath)) {
        try {
          const existingProjects = JSON.parse(fs.readFileSync(projectsJsonPath, 'utf8'));
          const newProjectsMap = new Map(existingProjects.map(p => [p.id, p]));
          projects.forEach(p => newProjectsMap.set(p.id, p));
          projects = Array.from(newProjectsMap.values());
          console.log(`Merged with existing projects. Total projects to keep in index: ${projects.length}`);
        } catch (e) {
          console.error("Failed to read existing projects.json, overwriting.", e);
        }
      }
    }
    
    fs.writeFileSync(
      path.join(SHOWCASE_DIR, 'projects.json'),
      JSON.stringify(projects, null, 2)
    );
    console.log(`Saved ${projects.length} projects to projects.json`);

    // 2. Fetch cache for each project (only the ones we explicitly want to export if specified)
    const projectsToFetch = targetProjectIds.length > 0 
      ? projects.filter(p => targetProjectIds.includes(p.id)) 
      : projects;

    for (const proj of projectsToFetch) {
      const qs = new URLSearchParams({
        owner: proj.owner,
        repo: proj.repo,
        repo_type: proj.repo_type,
        language: proj.language,
        comprehensive: 'true'
      });
      if (proj.model) {
        qs.append('model', proj.model);
      }
      
      const cacheUrl = `${BACKEND_URL}/api/wiki_cache?${qs.toString()}`;
      console.log(`Fetching cache for ${proj.id}...`);
      
      try {
        const cacheData = await fetchJson(cacheUrl);
        fs.writeFileSync(
          path.join(SHOWCASE_DIR, `wiki_${proj.id}.json`),
          JSON.stringify(cacheData, null, 2)
        );
        console.log(`  -> Saved wiki_${proj.id}.json`);
      } catch (err) {
        console.error(`  -> Failed to fetch cache for ${proj.id}: ${err.message}`);
      }
    }
    
    console.log('Export Complete!');
  } catch (err) {
    console.error('Export failed. Ensure the python backend is running locally.', err);
    process.exit(1);
  }
}

exportShowcase();
