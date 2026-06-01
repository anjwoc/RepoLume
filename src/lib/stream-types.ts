// AI 통신 로그의 타입 정의

export type LogType = 
  | "system"      // 시스템 메시지 (분석 시작, 완료 등)
  | "thinking"    // AI가 생각하는 중
  | "question"    // AI가 질문
  | "answer"      // 답변/응답
  | "tool_call"   // 도구 호출
  | "tool_result" // 도구 결과
  | "progress"    // 진행 상황
  | "error"       // 에러
  | "info";       // 일반 정보

export interface StreamLog {
  id: string;
  type: LogType;
  timestamp: Date;
  content: string;
  metadata?: {
    step?: number;
    totalSteps?: number;
    toolName?: string;
    duration?: number;
    tokens?: number;
    model?: string;
    isStreaming?: boolean;
  };
}

export interface AnalysisPhase {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "error";
  progress: number;
  logs: StreamLog[];
}

// 시뮬레이션용 더미 데이터 생성
export const ANALYSIS_PHASES: Omit<AnalysisPhase, "status" | "progress" | "logs">[] = [
  {
    id: "scan",
    name: "파일 스캔",
    description: "프로젝트 파일 구조를 읽어옵니다",
  },
  {
    id: "structure",
    name: "AI 구조 분석",
    description: "AI가 위키 구조(섹션/페이지)를 결정합니다",
  },
  {
    id: "generation",
    name: "페이지 생성",
    description: "각 페이지의 콘텐츠를 AI가 작성합니다",
  },
  {
    id: "save",
    name: "캐시 저장",
    description: "생성된 위키를 로컬에 저장합니다",
  },
];


// 시뮬레이션용 AI 대화 데이터
export const SIMULATION_CONVERSATIONS = [
  // Phase 1: 파일 스캔
  [
    { type: "system" as LogType, content: "프로젝트 디렉토리 스캔을 시작합니다..." },
    { type: "info" as LogType, content: "발견된 파일: 127개" },
    { type: "info" as LogType, content: "소스 코드 파일: 89개 (.ts, .tsx, .js)" },
    { type: "info" as LogType, content: "설정 파일: 12개 (package.json, tsconfig.json 등)" },
    { type: "thinking" as LogType, content: "프로젝트 구조를 분석 중입니다..." },
  ],
  // Phase 2: 코드 분석
  [
    { type: "system" as LogType, content: "코드 정적 분석을 시작합니다..." },
    { type: "thinking" as LogType, content: "AST(Abstract Syntax Tree)를 생성하고 있습니다..." },
    { type: "question" as LogType, content: "이 프로젝트의 주요 진입점이 어디인가요?", metadata: { model: "gpt-4o" } },
    { type: "answer" as LogType, content: "분석 결과, src/main.tsx가 메인 진입점이며, App.tsx가 루트 컴포넌트입니다. React 기반의 SPA 구조를 가지고 있습니다." },
    { type: "tool_call" as LogType, content: "파일 읽기: src/app/App.tsx", metadata: { toolName: "read_file" } },
    { type: "tool_result" as LogType, content: "App.tsx 분석 완료 - 상태 관리: useState, 라우팅: 조건부 렌더링", metadata: { duration: 234 } },
  ],
  // Phase 3: 의존성 분석
  [
    { type: "system" as LogType, content: "의존성 그래프를 구축합니다..." },
    { type: "thinking" as LogType, content: "package.json을 분석하여 외부 패키지 목록을 추출합니다..." },
    { type: "info" as LogType, content: "의존성 발견: react, motion, lucide-react, tailwindcss 등 23개 패키지" },
    { type: "question" as LogType, content: "컴포넌트 간 import 관계를 분석해야 합니다. 순환 의존성이 있나요?", metadata: { model: "gpt-4o" } },
    { type: "answer" as LogType, content: "순환 의존성은 발견되지 않았습니다. 컴포넌트 계층 구조가 깔끔하게 유지되고 있습니다. App → Screen Components → UI Components 순으로 의존합니다." },
    { type: "tool_call" as LogType, content: "의존성 트리 시각화 생성", metadata: { toolName: "create_dependency_graph" } },
    { type: "tool_result" as LogType, content: "의존성 그래프 생성 완료 - 노드: 89개, 엣지: 156개", metadata: { duration: 567 } },
  ],
  // Phase 4: AI 문서화
  [
    { type: "system" as LogType, content: "AI 문서 생성을 시작합니다...", metadata: { model: "gpt-4o" } },
    { type: "thinking" as LogType, content: "코드베이스의 전체적인 아키텍처를 이해하고 있습니다..." },
    { type: "question" as LogType, content: "이 프로젝트의 핵심 기능과 목적은 무엇인가요?", metadata: { model: "gpt-4o" } },
    { type: "answer" as LogType, content: "DeepWiki는 로컬 프로젝트의 소스 코드를 분석하여 자동으로 위키 문서를 생성하는 데스크탑 애플리케이션입니다. 주요 기능:\n1. 프로젝트 폴더 선택 및 분석\n2. AI 기반 문서 자동 생성\n3. Mermaid 다이어그램 지원\n4. Dark/Light 테마" },
    { type: "thinking" as LogType, content: "각 컴포넌트에 대한 상세 문서를 작성합니다..." },
    { type: "tool_call" as LogType, content: "마크다운 문서 생성: overview.md", metadata: { toolName: "write_markdown" } },
    { type: "tool_result" as LogType, content: "overview.md 생성 완료 (2,341 bytes)", metadata: { duration: 1234, tokens: 856 } },
    { type: "tool_call" as LogType, content: "마크다운 문서 생성: architecture.md", metadata: { toolName: "write_markdown" } },
    { type: "tool_result" as LogType, content: "architecture.md 생성 완료 (3,567 bytes)", metadata: { duration: 1567, tokens: 1203 } },
  ],
  // Phase 5: 다이어그램 생성
  [
    { type: "system" as LogType, content: "아키텍처 다이어그램을 생성합니다..." },
    { type: "thinking" as LogType, content: "시스템 구성요소를 Mermaid 형식으로 변환합니다..." },
    { type: "question" as LogType, content: "어떤 다이어그램 유형이 이 프로젝트에 가장 적합할까요?", metadata: { model: "gpt-4o" } },
    { type: "answer" as LogType, content: "이 프로젝트에는 다음 다이어그램이 적합합니다:\n1. 컴포넌트 다이어그램 (flowchart) - UI 구조 표현\n2. 시퀀스 다이어그램 - 사용자 플로우\n3. 클래스 다이어그램 - 타입/인터페이스 관계" },
    { type: "tool_call" as LogType, content: "Mermaid 다이어그램 생성: component-diagram.mmd", metadata: { toolName: "create_diagram" } },
    { type: "tool_result" as LogType, content: "컴포넌트 다이어그램 생성 완료", metadata: { duration: 890 } },
  ],
  // Phase 6: 위키 정리
  [
    { type: "system" as LogType, content: "위키 구조를 최종 정리합니다..." },
    { type: "thinking" as LogType, content: "생성된 모든 문서를 검토하고 링크를 연결합니다..." },
    { type: "info" as LogType, content: "생성된 문서: 8개" },
    { type: "info" as LogType, content: "생성된 다이어그램: 3개" },
    { type: "tool_call" as LogType, content: "위키 인덱스 생성", metadata: { toolName: "create_index" } },
    { type: "tool_result" as LogType, content: "위키 생성이 완료되었습니다!", metadata: { duration: 234 } },
    { type: "system" as LogType, content: "✨ 분석 완료! 위키를 열어보세요." },
  ],
];
