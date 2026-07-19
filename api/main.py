import os
import sys
import logging
from dotenv import load_dotenv

# Add the root directory to sys.path before any local imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables from .env file
load_dotenv()

# Corporate network SSL: point requests/urllib3 at the system cert bundle
# so adalflow/tiktoken can download BPE files at import time.
# Generate api/certs/ca-bundle.pem with: make setup-certs
_cert_bundle = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs", "ca-bundle.pem")
if os.path.exists(_cert_bundle):
    os.environ.setdefault("REQUESTS_CA_BUNDLE", _cert_bundle)
    os.environ.setdefault("SSL_CERT_FILE", _cert_bundle)

from api.logging_config import setup_logging

# Configure logging
setup_logging()
logger = logging.getLogger(__name__)

# Configure watchfiles logger to show file paths
watchfiles_logger = logging.getLogger("watchfiles.main")
watchfiles_logger.setLevel(logging.DEBUG)  # Enable DEBUG to see file paths

# Apply watchfiles monkey patch BEFORE uvicorn import
is_development = os.environ.get("NODE_ENV") != "production"
if is_development:
    import watchfiles
    current_dir = os.path.dirname(os.path.abspath(__file__))

    original_watch = watchfiles.watch
    def patched_watch(*args, **kwargs):
        # Only watch the api directory but exclude logs subdirectory
        # Instead of watching the entire api directory, watch specific subdirectories
        api_subdirs = []
        _EXCLUDE_DIRS = {"logs", "data", "__pycache__"}
        for item in os.listdir(current_dir):
            item_path = os.path.join(current_dir, item)
            if os.path.isdir(item_path) and item not in _EXCLUDE_DIRS:
                api_subdirs.append(item_path)
            elif os.path.isfile(item_path) and item.endswith(".py"):
                api_subdirs.append(item_path)
        
        return original_watch(*api_subdirs, **kwargs)
    watchfiles.watch = patched_watch

import uvicorn

# Check for required environment variables
required_env_vars = ['GOOGLE_API_KEY', 'OPENAI_API_KEY']
missing_vars = [var for var in required_env_vars if not os.environ.get(var)]
if missing_vars:
    logger.warning(f"Missing environment variables: {', '.join(missing_vars)}")
    logger.warning("Some functionality may not work correctly without these variables.")

# Configure Google Generative AI
import google.generativeai as genai
from api.config import GOOGLE_API_KEY

if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
else:
    logger.warning("GOOGLE_API_KEY not configured")

if __name__ == "__main__":
    # Get port from environment variable or use default
    port = int(os.environ.get("PORT", 8001))

    # Import the app here to ensure environment variables are set first
    from api.server import app

    logger.info(f"Starting Streaming API on port {port}")

    # Run the FastAPI app with uvicorn
    uvicorn.run(
        "api.server:app",
        host="0.0.0.0",
        port=port,
        reload=is_development,
        reload_dirs=["api", "cli"] if is_development else None,
        reload_excludes=["**/logs/**", "**/data/**", "**/__pycache__/**", "**/*.pyc"] if is_development else None,
    )
