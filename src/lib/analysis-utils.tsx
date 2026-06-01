"use client";

import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { AnalysisPhase, StreamLog } from "./stream-types";

type PhaseStatus = AnalysisPhase["status"];

interface ThemeColors {
  success: string;
  primary: string;
  error: string;
  divider: string;
}

// Phase 상태 아이콘 반환
export function getPhaseStatusIcon(status: PhaseStatus, theme: ThemeColors) {
  switch (status) {
    case "completed":
      return <CheckCircle size={16} color={theme.success} />;
    case "in_progress":
      return <Loader2 size={16} color={theme.primary} className="animate-spin" />;
    case "error":
      return <AlertCircle size={16} color={theme.error} />;
    default:
      return (
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `2px solid ${theme.divider}`,
          }}
        />
      );
  }
}

// Phase 진행률 계산
export function calculateTotalProgress(phases: AnalysisPhase[]): number {
  if (phases.length === 0) return 0;
  return phases.reduce((acc, p) => acc + p.progress, 0) / phases.length;
}

// Phase 상태 업데이트 유틸
export function updatePhaseStatus(
  phases: AnalysisPhase[],
  phaseIndex: number,
  status: PhaseStatus
): AnalysisPhase[] {
  return phases.map((p, i) =>
    i === phaseIndex ? { ...p, status } : p
  );
}

// Phase 진행률 업데이트 유틸
export function updatePhaseProgress(
  phases: AnalysisPhase[],
  phaseIndex: number,
  progress: number
): AnalysisPhase[] {
  return phases.map((p, i) =>
    i === phaseIndex ? { ...p, progress: Math.min(100, progress) } : p
  );
}

// Phase에 로그 추가 유틸
export function addLogToPhase(
  phases: AnalysisPhase[],
  phaseIndex: number,
  log: StreamLog,
  progressIncrement?: number
): AnalysisPhase[] {
  return phases.map((p, i) => {
    if (i !== phaseIndex) return p;
    const newProgress = progressIncrement
      ? Math.min(95, p.progress + progressIncrement)
      : p.progress;
    return {
      ...p,
      logs: [...p.logs, log],
      progress: newProgress,
    };
  });
}

// Phase 완료 처리 유틸
export function completePhase(
  phases: AnalysisPhase[],
  phaseIndex: number
): AnalysisPhase[] {
  return phases.map((p, i) =>
    i === phaseIndex ? { ...p, status: "completed", progress: 100 } : p
  );
}

// 고유 ID 생성
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// 로그 생성 헬퍼
export function createLog(
  type: StreamLog["type"],
  content: string,
  metadata?: StreamLog["metadata"]
): StreamLog {
  return {
    id: generateId(),
    type,
    timestamp: new Date(),
    content,
    metadata,
  };
}
