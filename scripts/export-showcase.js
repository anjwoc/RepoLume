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
    const projects = await fetchJson(projectsUrl);
    
    fs.writeFileSync(
      path.join(SHOWCASE_DIR, 'projects.json'),
      JSON.stringify(projects, null, 2)
    );
    console.log(`Saved ${projects.length} projects to projects.json`);

    // 2. Fetch cache for each project
    for (const proj of projects) {
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
