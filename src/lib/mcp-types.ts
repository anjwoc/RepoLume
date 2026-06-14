// MCP (Model Context Protocol) 데이터 소스 타입 정의

export type MCPProviderType =
  | "github"
  | "jira"
  | "confluence"
  | "dbhub"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "mssql"
  | "oracle"
  | "devdb"
  | "meta";

export type MCPEdition = "community" | "official" | "custom";

export interface MCPProvider {
  id: string;
  type: MCPProviderType;
  name: string;
  description: string;
  icon: string;
  category: "vcs" | "project" | "database";
  edition: MCPEdition;
  isEnabled: boolean;
  isConnected: boolean;
  config: MCPConfig;
  /** custom edition only: command loaded from mcp-config.yaml */
  customCommand?: string[];
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
  /** oracle: full SQLAlchemy DB URL (oracle+oracledb://user:pass@host:port/?service_name=SVC) */
  dbUrl?: string;
  /** meta: absolute path to the uv-managed script directory */
  scriptDir?: string;
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
    description: "GitHub / GHE 저장소에서 이슈, PR, 코드 검색을 연동합니다. 레파지토리는 쿼리 시점에 지정하므로 미리 설정 불필요.",
    icon: "github",
    category: "vcs",
    edition: "official",
    isEnabled: false,
    isConnected: false,
    config: { apiUrl: "https://github.gmarket.com" },
  },
  {
    id: "jira",
    type: "jira",
    name: "Jira",
    description: "Jira Data Center — @atlassian-dc-mcp/jira, JIRA_HOST만 설정",
    icon: "jira",
    category: "project",
    edition: "official",
    isEnabled: false,
    isConnected: false,
    config: { apiUrl: "https://jira.gmarket.com" },
  },
  {
    id: "confluence",
    type: "confluence",
    name: "Confluence",
    description: "Confluence Data Center — @atlassian-dc-mcp/confluence, CONFLUENCE_HOST만 설정",
    icon: "confluence",
    category: "project",
    edition: "official",
    isEnabled: false,
    isConnected: false,
    config: { apiUrl: "https://wiki.gmarket.com" },
  },
  {
    id: "dbhub-postgres",
    type: "postgresql",
    name: "PostgreSQL (DBHub)",
    description: "DBHub MCP를 통한 PostgreSQL 데이터베이스 연동",
    icon: "database",
    category: "database",
    edition: "official",
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
    edition: "official",
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
    edition: "official",
    isEnabled: false,
    isConnected: false,
    config: {},
  },
  {
    id: "devdb",
    type: "devdb",
    name: "SQL Server DevDB",
    description: "사내 SQL Server — HTTP/SSE MCP (type: http, serverURL만 지정)",
    icon: "database",
    category: "database",
    edition: "community",
    isEnabled: false,
    isConnected: false,
    config: { apiUrl: "https://mcp-sqlserver-explore-dawi.d3.clouz.io/sse" },
  },
  {
    id: "oracle",
    type: "oracle",
    name: "Oracle DB (UDVORA)",
    description: "uvx --with oracledb mcp-alchemy — DB_URL 환경변수로 연결",
    icon: "database",
    category: "database",
    edition: "community",
    isEnabled: false,
    isConnected: false,
    config: { dbUrl: "oracle+oracledb://S_GAFFILIATE:G_geA7F%241Kz@UDVORA-SCAN.gmarket.nh:1521/?service_name=UDVORA" },
  },
  {
    id: "meta",
    type: "meta",
    name: "DB 메타데이터",
    description: "uv run main.py — meta.gmarket.com / dbportal.gmarket.com 연동",
    icon: "database",
    category: "database",
    edition: "community",
    isEnabled: false,
    isConnected: false,
    config: { scriptDir: "/Users/jaecjeong/toolbox/skills/oh-my-rebuild/mcp/meta", username: "jaecjeong", password: "" },
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
} as const;
