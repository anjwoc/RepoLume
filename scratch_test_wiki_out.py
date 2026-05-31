import os
import json
import time

WIKI_OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wiki-out")

def test_scan_wiki_out():
    entries = []
    if os.path.exists(WIKI_OUT_DIR):
        for dirname in os.listdir(WIKI_OUT_DIR):
            dir_path = os.path.join(WIKI_OUT_DIR, dirname)
            if os.path.isdir(dir_path) and not dirname.startswith("."):
                stat = os.stat(dir_path)
                entries.append({
                    "id": f"wiki-out-{dirname}",
                    "owner": "local",
                    "repo": dirname,
                    "name": f"local/{dirname}",
                    "repo_type": "local",
                    "submittedAt": int(stat.st_mtime * 1000),
                    "language": "ko"
                })
    return entries

def test_read_wiki_out(repo):
    repo_dir = os.path.join(WIKI_OUT_DIR, repo)
    if not os.path.exists(repo_dir):
        return None
        
    pages = []
    generated_pages = {}
    sections = []
    rootSections = []
    
    for item in os.listdir(repo_dir):
        item_path = os.path.join(repo_dir, item)
        if os.path.isdir(item_path) and not item.startswith("."):
            rootSections.append(item)
            section_pages = []
            for f in os.listdir(item_path):
                if f.endswith(".md"):
                    page_id = f.replace(".md", "")
                    section_pages.append(page_id)
                    with open(os.path.join(item_path, f), "r", encoding="utf-8") as fd:
                        content = fd.read()
                    
                    page_obj = {
                        "id": page_id,
                        "title": page_id,
                        "content": content,
                        "filePaths": [],
                        "importance": "medium",
                        "relatedPages": []
                    }
                    pages.append(page_obj)
                    generated_pages[page_id] = page_obj
                    
            sections.append({
                "id": item,
                "title": item,
                "pages": section_pages
            })
            
    wiki_structure = {
        "id": repo,
        "title": f"{repo} Wiki",
        "description": "Generated from wiki-out folder",
        "pages": pages,
        "sections": sections,
        "rootSections": rootSections
    }
    
    return {
        "wiki_structure": wiki_structure,
        "generated_pages": generated_pages,
        "repo": {
            "owner": "local",
            "repo": repo,
            "type": "local",
            "localPath": repo_dir,
            "repoUrl": repo_dir
        },
        "provider": "local",
        "model": "local"
    }

print("Entries:", json.dumps(test_scan_wiki_out(), indent=2))
print("Wiki Cache keys:", test_read_wiki_out("localwiki").keys())
