import sys
import json

sys.path.append('.')
from api.api import WikiCacheData

p = '/Users/jcjeong/.adalflow/wikicache/localwiki_cache_local_local_local-deepwiki_en_agy-gemini-3.5-flash-high.json'
try:
    with open(p, 'r') as f:
        data = json.load(f)
    WikiCacheData(**data)
    print("Valid!")
except Exception as e:
    print(f"Error: {e}")
