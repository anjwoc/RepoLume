import os

import uvicorn
from dotenv import load_dotenv

load_dotenv()

from api.server import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8001")),
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )
