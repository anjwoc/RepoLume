"use client";

import { 
  Bot, Wrench, CheckCircle, AlertCircle, Loader2,
  Clock, Cpu, Zap, FileText, Sparkles, Info
} from "lucide-react";
import type { LogType } from "./stream-types";

interface LogColors {
  bg: string;
  text: string;
  border: string;
}

interface ThemeColors {
  aiLight: string;
  ai: string;
  successLight: string;
  success: string;
  warningLight: string;
  warning: string;
  errorLight: string;
  error: string;
  primaryLight: string;
  primary: string;
  surface: string;
  textSecondary: string;
  divider: string;
  userLight: string;
  user: string;
}

// 로그 타입별 아이콘 반환
export function getLogIcon(type: LogType, size: number = 14) {
  const iconProps = { size };
  
  switch (type) {
    case "thinking":
      return <Loader2 {...iconProps} className="animate-spin" />;
    case "question":
      return <Bot {...iconProps} />;
    case "answer":
      return <Sparkles {...iconProps} />;
    case "tool_call":
      return <Wrench {...iconProps} />;
    case "tool_result":
      return <CheckCircle {...iconProps} />;
    case "error":
      return <AlertCircle {...iconProps} />;
    case "system":
      return <Cpu {...iconProps} />;
    case "info":
      return <Info {...iconProps} />;
    case "progress":
      return <Zap {...iconProps} />;
    default:
      return <FileText {...iconProps} />;
  }
}

// 로그 타입별 컬러 반환
export function getLogColor(type: LogType, theme: ThemeColors): LogColors {
  switch (type) {
    case "thinking":
      return { bg: theme.aiLight, text: theme.ai, border: theme.ai };
    case "question":
      return { bg: theme.aiLight, text: theme.ai, border: theme.ai };
    case "answer":
      return { bg: theme.successLight, text: theme.success, border: theme.success };
    case "tool_call":
      return { bg: theme.warningLight, text: theme.warning, border: theme.warning };
    case "tool_result":
      return { bg: theme.successLight, text: theme.success, border: theme.success };
    case "error":
      return { bg: theme.errorLight, text: theme.error, border: theme.error };
    case "system":
      return { bg: theme.primaryLight, text: theme.primary, border: theme.primary };
    case "info":
      return { bg: theme.surface, text: theme.textSecondary, border: theme.divider };
    case "progress":
      return { bg: theme.userLight, text: theme.user, border: theme.user };
    default:
      return { bg: theme.surface, text: theme.textSecondary, border: theme.divider };
  }
}

// 로그 타입별 라벨 반환
export function getLogLabel(type: LogType): string {
  const labels: Record<LogType, string> = {
    thinking: "AI 사고 중",
    question: "AI 질문",
    answer: "AI 응답",
    tool_call: "도구 호출",
    tool_result: "결과",
    error: "오류",
    system: "시스템",
    info: "정보",
    progress: "진행",
  };
  return labels[type] || "로그";
}

// 메타데이터 포맷팅 유틸
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tokens`;
  return `${(tokens / 1000).toFixed(1)}k tokens`;
}

export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Clock 아이콘 내보내기 (메타데이터 렌더링에 사용)
export { Clock };
