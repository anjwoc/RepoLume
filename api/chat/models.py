from pydantic import BaseModel, Field
from typing import List, Optional


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    repo_url: str = Field(..., description="URL or local path of the repository to query")
    messages: List[ChatMessage] = Field(..., description="List of chat messages")
    filePath: Optional[str] = Field(None)
    token: Optional[str] = Field(None)
    type: Optional[str] = Field("github")
    provider: str = Field("google")
    model: Optional[str] = Field(None)
    language: Optional[str] = Field("ko")
    excluded_dirs: Optional[str] = Field(None)
    excluded_files: Optional[str] = Field(None)
    included_dirs: Optional[str] = Field(None)
    included_files: Optional[str] = Field(None)
    stream_id: Optional[str] = Field(None, description="Side-channel progress event stream ID")
    skip_rag: Optional[bool] = Field(False)
    litellm_base_url: Optional[str] = Field(None)
    api_key: Optional[str] = Field(None)
    use_cli: Optional[bool] = Field(False)
    cli_tool: Optional[str] = Field(None)
    is_wiki_generation: Optional[bool] = Field(False)
    async_mode: Optional[bool] = Field(False)
    task_id: Optional[str] = Field(None)
