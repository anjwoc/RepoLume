import os
import requests
import logging
from pathlib import Path
from typing import Dict

logger = logging.getLogger(__name__)

class ConfluencePublisher:
    def __init__(self, base_url: str, space_key: str, auth_token: str, username: str = None):
        self.base_url = base_url.rstrip('/')
        self.space_key = space_key
        self.auth_token = auth_token
        self.username = username
        self.headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        if self.username:
            self.auth = (self.username, self.auth_token)
        else:
            self.auth = None
            self.headers['Authorization'] = f'Bearer {self.auth_token}'

    def publish_page(self, title: str, markdown_content: str, parent_id: str = None) -> str:
        body_storage = f"""
        <ac:structured-macro ac:name="markdown" ac:schema-version="1">
          <ac:plain-text-body><![CDATA[{markdown_content}]]></ac:plain-text-body>
        </ac:structured-macro>
        """
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": self.space_key},
            "body": {
                "storage": {
                    "value": body_storage,
                    "representation": "storage"
                }
            }
        }
        if parent_id:
            payload['ancestors'] = [{"id": parent_id}]

        search_url = f"{self.base_url}/rest/api/content?spaceKey={self.space_key}&title={title}&expand=version"
        try:
            resp = requests.get(search_url, headers=self.headers, auth=self.auth)
            resp.raise_for_status()
            results = resp.json().get('results', [])
            if results:
                page_id = results[0]['id']
                current_version = results[0]['version']['number']
                payload['version'] = {'number': current_version + 1}
                update_url = f"{self.base_url}/rest/api/content/{page_id}"
                update_resp = requests.put(update_url, headers=self.headers, auth=self.auth, json=payload)
                update_resp.raise_for_status()
                logger.info(f"Updated existing page '{title}' (ID: {page_id})")
                return page_id
            else:
                create_url = f"{self.base_url}/rest/api/content"
                create_resp = requests.post(create_url, headers=self.headers, auth=self.auth, json=payload)
                create_resp.raise_for_status()
                page_id = create_resp.json()['id']
                logger.info(f"Created new page '{title}' (ID: {page_id})")
                return page_id
        except Exception as e:
            logger.error(f"Failed to publish '{title}': {e}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            raise

    def publish_directory(self, root_dir: Path, root_title: str = "RepoLume Export", root_parent_id: str = None):
        logger.info(f"Publishing directory {root_dir} to space {self.space_key}")
        
        # Create root index page
        root_content = f"# {root_title}\n\nAutomated Wiki Export from RepoLume."
        root_page_id = self.publish_page(root_title, root_content, root_parent_id)
        
        # We need to map relative directory paths to Confluence Page IDs
        dir_to_page_id: Dict[Path, str] = {root_dir: root_page_id}
        
        for current_path, dirs, files in os.walk(root_dir):
            current_path = Path(current_path)
            parent_id = dir_to_page_id.get(current_path, root_page_id)
            
            # Create a page for each directory to act as a parent for nested files
            for d in dirs:
                dir_path = current_path / d
                dir_title = f"{root_title} - {d}"
                dir_id = self.publish_page(dir_title, f"# {d} Index", parent_id)
                dir_to_page_id[dir_path] = dir_id
                
            for f in files:
                if f.endswith('.md'):
                    file_path = current_path / f
                    title = f"{root_title} - {f.replace('.md', '')}"
                    with open(file_path, 'r', encoding='utf-8') as fh:
                        content = fh.read()
                    self.publish_page(title, content, parent_id)
        
        logger.info(f"Finished publishing {root_dir}")
