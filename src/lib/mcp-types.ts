// MCP (Model Context Protocol) 데이터 소스 타입 정의

export type MCPProviderType =
  | "github"
  | "jira"
  | "confluence"
  | "dbhub"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "notion"
  | "linear"
  | "slack";

export interface MCPProvider {
  id: string;
  type: MCPProviderType;
  name: string;
  description: string;
  icon: string;
  category: "vcs" | "project" | "database" | "communication";
  isEnabled: boolean;
  isConnected: boolean;
  config: MCPConfig;
}

export interface MCPConfig {
  apiToken?: string;
  apiUrl?: string;
  workspace?: string;
  repository?: string;
  database?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  options?: Record<string, string | boolean | number>;
}

export interface MCPSettings {
  crossCheckEnabled: boolean;
  autoSync: boolean;
  syncInterval: number; // minutes
  providers: MCPProvider[];
}

// 기본 MCP 프로바이더 목록
export const DEFAULT_MCP_PROVIDERS: MCPProvider[] = [
  {
    id: "github",
    type: "github",
    name: "GitHub",
    description: "GitHub 저장소에서 이슈, PR, 위키 등을 연동합니다",
    icon: "github",
    category: "vcs",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "jira",
    type: "jira",
    name: "Jira",
    description: "Jira 프로젝트의 이슈와 에픽을 연동합니다",
    icon: "jira",
    category: "project",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "confluence",
    type: "confluence",
    name: "Confluence",
    description: "Confluence 페이지와 문서를 연동합니다",
    icon: "confluence",
    category: "project",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "notion",
    type: "notion",
    name: "Notion",
    description: "Notion 워크스페이스와 페이지를 연동합니다",
    icon: "notion",
    category: "project",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "linear",
    type: "linear",
    name: "Linear",
    description: "Linear 이슈와 프로젝트를 연동합니다",
    icon: "linear",
    category: "project",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "dbhub-postgres",
    type: "postgresql",
    name: "PostgreSQL (DBHub)",
    description: "DBHub MCP를 통한 PostgreSQL 데이터베이스 연동",
    icon: "database",
    category: "database",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "dbhub-mysql",
    type: "mysql",
    name: "MySQL (DBHub)",
    description: "DBHub MCP를 통한 MySQL 데이터베이스 연동",
    icon: "database",
    category: "database",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "dbhub-mongodb",
    type: "mongodb",
    name: "MongoDB (DBHub)",
    description: "DBHub MCP를 통한 MongoDB 데이터베이스 연동",
    icon: "database",
    category: "database",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "slack",
    type: "slack",
    name: "Slack",
    description: "Slack 채널과 메시지를 연동합니다",
    icon: "slack",
    category: "communication",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
];

// 기본 설정
export const DEFAULT_MCP_SETTINGS: MCPSettings = {
  crossCheckEnabled: true,
  autoSync: false,
  syncInterval: 30,
  providers: DEFAULT_MCP_PROVIDERS,
};

// 카테고리 정보
export const MCP_CATEGORIES = {
  vcs: { name: "버전 관리", description: "소스 코드 저장소 연동" },
  project: { name: "프로젝트 관리", description: "이슈 트래킹 및 문서 연동" },
  database: { name: "데이터베이스", description: "DB 스키마 및 데이터 연동" },
  communication: { name: "커뮤니케이션", description: "팀 협업 도구 연동" },
} as const;
