"""Shared Pydantic models used across multiple route modules."""
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional


class WikiPage(BaseModel):
    id: str
    title: str
    content: str
    filePaths: List[str]
    importance: str
    relatedPages: List[str]


class ProcessedProjectEntry(BaseModel):
    id: str
    owner: str
    repo: str
    name: str
    repo_type: str
    submittedAt: int
    language: str
    model: Optional[str] = None
    slug: Optional[str] = None


class RepoInfo(BaseModel):
    owner: str
    repo: str
    type: str
    token: Optional[str] = None
    localPath: Optional[str] = None
    repoUrl: Optional[str] = None
    githubRepoUrl: Optional[str] = None
    githubBranch: Optional[str] = None


class WikiSection(BaseModel):
    id: str
    title: str
    pages: List[str]
    subsections: Optional[List[str]] = None


class WikiStructureModel(BaseModel):
    id: str
    title: str
    description: str
    pages: List[WikiPage]
    sections: Optional[List[WikiSection]] = None
    rootSections: Optional[List[str]] = None


class WikiCacheData(BaseModel):
    wiki_structure: WikiStructureModel
    generated_pages: Dict[str, WikiPage]
    repo_url: Optional[str] = None
    repo: Optional[RepoInfo] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    language: Optional[str] = None
    source_path: Optional[str] = None
    artifact_root: Optional[str] = None


class WikiCacheRequest(BaseModel):
    repo: RepoInfo
    language: str
    wiki_structure: WikiStructureModel
    generated_pages: Dict[str, WikiPage]
    provider: str
    model: Optional[str] = None


class WikiExportRequest(BaseModel):
    repo_url: str = Field(..., description="Repository URL")
    pages: List[WikiPage] = Field(..., description="Pages to export")
    format: Literal["markdown", "json"] = Field(...)
    structure: Literal["single", "tree"] = Field("single")
    wiki_structure: Optional[WikiStructureModel] = Field(None)


class Model(BaseModel):
    id: str
    name: str


class Provider(BaseModel):
    id: str
    name: str
    models: List[Model]
    supportsCustomModel: Optional[bool] = False


class ModelConfig(BaseModel):
    providers: List[Provider]
    defaultProvider: str


class AuthorizationConfig(BaseModel):
    code: str


class AuthCodeSubmit(BaseModel):
    code: str
