import os
import sys
import unittest
from unittest.mock import patch, MagicMock

# Add the project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

from api.wiki_rag import retrieve_wiki_context

class TestWikiRAG(unittest.TestCase):
    @patch('api.wiki_rag.WIKI_EMBEDDER_TYPE', 'none')
    def test_rag_with_none_embedder(self):
        # We don't actually need to initialize if none is set correctly
        pages = [{"title": "Mock Title", "content": "Mock Content"}]
        
        # Test full context retrieval bypass
        context, titles = retrieve_wiki_context(pages, "query")
        
        self.assertIn("Mock Title", context, "Should return full context when embedder is 'none'")
        self.assertIn("Mock Title", titles, "Should return titles list")

class AsyncMock(MagicMock):
    async def __call__(self, *args, **kwargs):
        return super(AsyncMock, self).__call__(*args, **kwargs)



if __name__ == '__main__':
    unittest.main()
