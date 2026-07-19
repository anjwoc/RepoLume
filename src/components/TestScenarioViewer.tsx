"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight,
  Database, Server, MessageSquare, Zap, Bug, GitBranch, Activity,
  RefreshCw, Copy, Check, Filter, Search, ArrowRight, Loader2,
} from "lucide-react";
import { getTheme } from "@/lib/theme";
import Markdown from "./Markdown";
import type {
  TestGenProgress,
  TestGenPhase,
  LogEntry,
  ScenarioType,
  TestStep,
} from "@/lib/test-scenario-types";

// ── Types ───────────────────────────────────────────────────────────────────

interface ScenarioResult {
  id: string;
  flowId: string;
  flowName: string;
  type: ScenarioType;
  title: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'warning';
  steps: StepResult[];
  markdown?: string;
  logs: LogEntry[];
  startedAt?: string;
  completedAt?: string;
  duration?: number;
}

interface StepResult {
  stepNumber: number;
  service: string;
  action: string;
  protocol?: string;
  expected: string;
  actual?: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  assertionSql?: string;
  sqlResult?: string;
  logs: LogEntry[];
  duration?: number;
}

interface TestScenarioViewerProps {
  isDark: boolean;
  flowId: string;
  flowName: string;
  scenarios: ScenarioResult[];
  progress?: TestGenProgress;
  onRunScenario?: (scenarioId: string) => void;
  onRunAllScenarios?: () => void;
  onGenerateScenarios?: () => void;
}

// ── Constants ───────────────────────────────────────────────────────────────

const SCENARIO_TYPE_META: Record<ScenarioType, {
  label: string;
  icon: typeof Play;
  color: string;
  bgColor: string;
  description: string;
}> = {
  'happy-path': {
    label: 'Happy Path E2E',
    icon: CheckCircle,
    color: '#34d399',
    bgColor: 'rgba(52,211,153,0.12)',
    description: '정상 흐름 전체 검증',
  },
  'data-integrity': {
    label: 'Data Integrity',
    icon: Database,
    color: '#60a5fa',
    bgColor: 'rgba(96,165,250,0.12)',
    description: 'DB 상태 변화 검증',
  },
  'error-recovery': {
    label: 'Error Recovery',
    icon: Bug,
    color: '#f87171',
    bgColor: 'rgba(248,113,113,0.12)',
    description: '장애 복구 시나리오',
  },
  'cross-flow': {
    label: 'Cross-Flow',
    icon: GitBranch,
    color: '#a78bfa',
    bgColor: 'rgba(167,139,250,0.12)',
    description: '플로우 간 연쇄 검증',
  },
  'data-flow-trace': {
    label: 'Data Flow Trace',
    icon: Activity,
    color: '#fbbf24',
    bgColor: 'rgba(251,191,36,0.12)',
    description: '서비스 간 통신 추적',
  },
};

const PHASE_LABELS: Record<TestGenPhase, string> = {
  'parsing': '위키 문서 파싱',
  'analyzing-cross-flow': '크로스 플로우 분석',
  'building-prompt': '프롬프트 생성',
  'generating': 'LLM 시나리오 생성',
  'writing-output': '산출물 저장',
};

const STATUS_COLORS = {
  pending: '#94a3b8',
  running: '#60a5fa',
  success: '#34d399',
  error: '#f87171',
  warning: '#fbbf24',
  skipped: '#94a3b8',
};

const LOG_LEVEL_META: Record<string, { label: string; color: string; bg: string }> = {
  info:  { label: 'INFO',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  warn:  { label: 'WARN',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  error: { label: 'ERROR', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  debug: { label: 'DEBUG', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
};

// ── Main Component ──────────────────────────────────────────────────────────

export function TestScenarioViewer({
  isDark,
  flowId,
  flowName,
  scenarios,
  progress,
  onRunScenario,
  onRunAllScenarios,
  onGenerateScenarios,
}: TestScenarioViewerProps) {
  const t = getTheme(isDark);
  const [activeTab, setActiveTab] = useState<ScenarioType | 'all' | 'logs'>('all');
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [logFilter, setLogFilter] = useState<string>('');
  const [logLevelFilter, setLogLevelFilter] = useState<Set<string>>(new Set(['info', 'warn', 'error']));
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scenarios]);

  const toggleScenario = useCallback((id: string) => {
    setExpandedScenarios(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleStep = useCallback((key: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const filteredScenarios = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'logs') return scenarios;
    return scenarios.filter(s => s.type === activeTab);
  }, [scenarios, activeTab]);

  const allLogs = useMemo(() => {
    const logs: (LogEntry & { source: string })[] = [];
    for (const scenario of scenarios) {
      for (const log of scenario.logs) {
        logs.push({ ...log, source: `${scenario.flowId}/${scenario.type}` });
      }
      for (const step of scenario.steps) {
        for (const log of step.logs) {
          logs.push({ ...log, source: `${scenario.flowId}/Step${step.stepNumber}` });
        }
      }
    }
    return logs
      .filter(l => logLevelFilter.has(l.level))
      .filter(l => !logFilter || l.message.toLowerCase().includes(logFilter.toLowerCase()))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [scenarios, logFilter, logLevelFilter]);

  const scenarioStats = useMemo(() => {
    const total = scenarios.length;
    const success = scenarios.filter(s => s.status === 'success').length;
    const error = scenarios.filter(s => s.status === 'error').length;
    const running = scenarios.filter(s => s.status === 'running').length;
    const pending = scenarios.filter(s => s.status === 'pending').length;
    return { total, success, error, running, pending };
  }, [scenarios]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: t.bg,
      color: t.text,
      fontFamily: 'var(--font-sans), system-ui, sans-serif',
    }}>
      {/* ── Header ── */}
      <Header
        t={t}
        flowId={flowId}
        flowName={flowName}
        stats={scenarioStats}
        progress={progress}
        onGenerateScenarios={onGenerateScenarios}
        onRunAllScenarios={onRunAllScenarios}
      />

      {/* ── Tab Bar ── */}
      <TabBar
        t={t}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        scenarioCounts={scenarios.reduce((acc, s) => {
          acc[s.type] = (acc[s.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)}
      />

      {/* ── Content Area ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {activeTab === 'logs' ? (
          <LogPanel
            t={t}
            logs={allLogs}
            logFilter={logFilter}
            logLevelFilter={logLevelFilter}
            onFilterChange={setLogFilter}
            onLevelToggle={(level) => {
              setLogLevelFilter(prev => {
                const next = new Set(prev);
                next.has(level) ? next.delete(level) : next.add(level);
                return next;
              });
            }}
            logEndRef={logEndRef}
          />
        ) : (
          <ScenarioList
            t={t}
            scenarios={filteredScenarios}
            expandedScenarios={expandedScenarios}
            expandedSteps={expandedSteps}
            onToggleScenario={toggleScenario}
            onToggleStep={toggleStep}
            onRunScenario={onRunScenario}
          />
        )}
      </div>

      {/* ── Progress Bar (when generating) ── */}
      {progress && (
        <ProgressBar t={t} progress={progress} />
      )}
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────────────────────────

function Header({ t, flowId, flowName, stats, progress, onGenerateScenarios, onRunAllScenarios }: {
  t: ReturnType<typeof getTheme>;
  flowId: string;
  flowName: string;
  stats: { total: number; success: number; error: number; running: number; pending: number };
  progress?: TestGenProgress;
  onGenerateScenarios?: () => void;
  onRunAllScenarios?: () => void;
}) {
  return (
    <div style={{
      padding: '16px 20px',
      borderBottom: `1px solid ${t.divider}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Zap size={18} color="#fff" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {flowId}: {flowName}
          </h2>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, display: 'flex', gap: 12 }}>
            <span>총 {stats.total}개 시나리오</span>
            {stats.success > 0 && <span style={{ color: STATUS_COLORS.success }}>✓ {stats.success}</span>}
            {stats.error > 0 && <span style={{ color: STATUS_COLORS.error }}>✗ {stats.error}</span>}
            {stats.running > 0 && <span style={{ color: STATUS_COLORS.running }}>⟳ {stats.running}</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {onGenerateScenarios && (
          <button
            onClick={onGenerateScenarios}
            disabled={!!progress}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: progress ? t.divider : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', fontSize: 13, fontWeight: 500,
              cursor: progress ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: progress ? 0.6 : 1,
            }}
          >
            {progress ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
            {progress ? '생성 중...' : '시나리오 생성'}
          </button>
        )}
        {onRunAllScenarios && stats.total > 0 && (
          <button
            onClick={onRunAllScenarios}
            style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${t.divider}`,
              background: 'transparent', color: t.text, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Play size={14} /> 전체 실행
          </button>
        )}
      </div>
    </div>
  );
}

function TabBar({ t, activeTab, onTabChange, scenarioCounts }: {
  t: ReturnType<typeof getTheme>;
  activeTab: string;
  onTabChange: (tab: ScenarioType | 'all' | 'logs') => void;
  scenarioCounts: Record<string, number>;
}) {
  const tabs: { id: ScenarioType | 'all' | 'logs'; label: string; icon: typeof Play }[] = [
    { id: 'all', label: '전체', icon: Zap },
    ...Object.entries(SCENARIO_TYPE_META).map(([id, meta]) => ({
      id: id as ScenarioType,
      label: meta.label,
      icon: meta.icon,
    })),
    { id: 'logs', label: '로그', icon: MessageSquare },
  ];

  return (
    <div style={{
      display: 'flex', gap: 0, padding: '0 20px',
      borderBottom: `1px solid ${t.divider}`,
      overflowX: 'auto',
    }}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        const count = tab.id === 'all'
          ? Object.values(scenarioCounts).reduce((a, b) => a + b, 0)
          : tab.id === 'logs' ? undefined
          : scenarioCounts[tab.id] ?? 0;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              padding: '10px 14px',
              border: 'none',
              borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
              background: 'transparent',
              color: isActive ? '#6366f1' : t.textMuted,
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            <Icon size={14} />
            {tab.label}
            {count !== undefined && count > 0 && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10,
                background: isActive ? 'rgba(99,102,241,0.15)' : t.divider,
                color: isActive ? '#6366f1' : t.textMuted,
              }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ScenarioList({ t, scenarios, expandedScenarios, expandedSteps, onToggleScenario, onToggleStep, onRunScenario }: {
  t: ReturnType<typeof getTheme>;
  scenarios: ScenarioResult[];
  expandedScenarios: Set<string>;
  expandedSteps: Set<string>;
  onToggleScenario: (id: string) => void;
  onToggleStep: (key: string) => void;
  onRunScenario?: (id: string) => void;
}) {
  if (scenarios.length === 0) {
    return (
      <div style={{
        padding: 40, textAlign: 'center', color: t.textMuted,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <Zap size={32} style={{ opacity: 0.3 }} />
        <p>테스트 시나리오가 없습니다.</p>
        <p style={{ fontSize: 13 }}>위의 "시나리오 생성" 버튼을 눌러 위키 문서에서 시나리오를 자동 생성하세요.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {scenarios.map(scenario => (
        <ScenarioCard
          key={scenario.id}
          t={t}
          scenario={scenario}
          isExpanded={expandedScenarios.has(scenario.id)}
          expandedSteps={expandedSteps}
          onToggle={() => onToggleScenario(scenario.id)}
          onToggleStep={onToggleStep}
          onRun={onRunScenario ? () => onRunScenario(scenario.id) : undefined}
        />
      ))}
    </div>
  );
}

function ScenarioCard({ t, scenario, isExpanded, expandedSteps, onToggle, onToggleStep, onRun }: {
  t: ReturnType<typeof getTheme>;
  scenario: ScenarioResult;
  isExpanded: boolean;
  expandedSteps: Set<string>;
  onToggle: () => void;
  onToggleStep: (key: string) => void;
  onRun?: () => void;
}) {
  const meta = SCENARIO_TYPE_META[scenario.type];
  const Icon = meta.icon;
  const statusColor = STATUS_COLORS[scenario.status];

  return (
    <div style={{
      border: `1px solid ${t.divider}`,
      borderRadius: 10,
      overflow: 'hidden',
      borderLeft: `3px solid ${meta.color}`,
    }}>
      {/* Scenario Header */}
      <div
        onClick={onToggle}
        style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          background: isExpanded ? (t as any).surfaceHover ?? 'rgba(128,128,128,0.04)' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {isExpanded ? <ChevronDown size={14} color={t.textMuted} /> : <ChevronRight size={14} color={t.textMuted} />}

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 6,
          background: meta.bgColor, color: meta.color,
          fontSize: 11, fontWeight: 600,
        }}>
          <Icon size={12} /> {meta.label}
        </span>

        <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{scenario.title}</span>

        {/* Status indicator */}
        <StatusBadge status={scenario.status} />

        {/* Step count */}
        <span style={{ fontSize: 11, color: t.textMuted }}>
          {scenario.steps.filter(s => s.status === 'success').length}/{scenario.steps.length} steps
        </span>

        {/* Duration */}
        {scenario.duration && (
          <span style={{ fontSize: 11, color: t.textMuted }}>
            {(scenario.duration / 1000).toFixed(1)}s
          </span>
        )}

        {onRun && scenario.status !== 'running' && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            style={{
              padding: '4px 10px', borderRadius: 6, border: `1px solid ${t.divider}`,
              background: 'transparent', color: t.text, fontSize: 11,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Play size={10} /> 실행
          </button>
        )}
      </div>

      {/* Expanded Content: Steps */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 16px 12px' }}>
              {scenario.markdown && (
                <div style={{ marginTop: 12, padding: 16, borderRadius: 8, background: t.surface }}>
                  <Markdown content={scenario.markdown} />
                </div>
              )}
              {/* Step list */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                marginTop: 8,
              }}>
                {scenario.steps.map((step, idx) => (
                  <StepRow
                    key={`${scenario.id}-${step.stepNumber}`}
                    t={t}
                    step={step}
                    stepKey={`${scenario.id}-${step.stepNumber}`}
                    isExpanded={expandedSteps.has(`${scenario.id}-${step.stepNumber}`)}
                    isLast={idx === scenario.steps.length - 1}
                    onToggle={() => onToggleStep(`${scenario.id}-${step.stepNumber}`)}
                  />
                ))}
              </div>

              {/* Scenario-level logs */}
              {scenario.logs.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>
                    시나리오 로그 ({scenario.logs.length})
                  </div>
                  <div style={{
                    maxHeight: 200, overflow: 'auto',
                    background: t.bg, borderRadius: 6,
                    border: `1px solid ${t.divider}`, padding: 8,
                  }}>
                    {scenario.logs.map((log, i) => (
                      <CompactLogRow key={i} log={log} t={t} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ t, step, stepKey, isExpanded, isLast, onToggle }: {
  t: ReturnType<typeof getTheme>;
  step: StepResult;
  stepKey: string;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const statusColor = STATUS_COLORS[step.status];
  const hasDetails = step.assertionSql || step.sqlResult || step.logs.length > 0;

  return (
    <div>
      <div
        onClick={hasDetails ? onToggle : undefined}
        style={{
          display: 'grid',
          gridTemplateColumns: '24px 28px 1fr 120px 100px 32px',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderRadius: 6,
          cursor: hasDetails ? 'pointer' : 'default',
          fontSize: 13,
          borderLeft: `2px solid ${isLast ? 'transparent' : t.divider}`,
          marginLeft: 8,
          transition: 'background 0.1s',
        }}
      >
        {/* Step connector dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusColor,
          marginLeft: -13,
          boxShadow: step.status === 'running' ? `0 0 6px ${statusColor}` : 'none',
        }} />

        {/* Step number */}
        <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>
          #{step.stepNumber}
        </span>

        {/* Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: t.textMuted }}>{step.service}</span>
          <ArrowRight size={10} color={t.textMuted} />
          <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>
            {step.action}
          </span>
        </div>

        {/* Protocol */}
        {step.protocol && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: t.divider, color: t.textMuted,
          }}>
            {step.protocol}
          </span>
        )}

        {/* Expected */}
        <span style={{ fontSize: 11, color: t.textMuted, textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {step.expected}
        </span>

        {/* Duration */}
        <span style={{ fontSize: 10, color: t.textMuted, textAlign: 'right' }}>
          {step.duration ? `${step.duration}ms` : ''}
        </span>
      </div>

      {/* Expanded step details */}
      <AnimatePresence>
        {isExpanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{
              overflow: 'hidden',
              marginLeft: 32, marginBottom: 4, padding: '8px 12px',
              background: t.bg, borderRadius: 6,
              border: `1px solid ${t.divider}`,
            }}
          >
            {step.assertionSql && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>
                  Assertion SQL
                </div>
                <pre style={{
                  fontSize: 11, padding: 8, borderRadius: 4,
                  background: t.divider, color: t.text,
                  overflow: 'auto', margin: 0,
                  fontFamily: 'var(--font-mono), monospace',
                }}>
                  {step.assertionSql}
                </pre>
              </div>
            )}

            {step.sqlResult && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>
                  SQL Result
                </div>
                <pre style={{
                  fontSize: 11, padding: 8, borderRadius: 4,
                  background: step.status === 'success'
                    ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
                  color: t.text, overflow: 'auto', margin: 0,
                  fontFamily: 'var(--font-mono), monospace',
                }}>
                  {step.sqlResult}
                </pre>
              </div>
            )}

            {step.logs.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>
                  Step 로그 ({step.logs.length})
                </div>
                {step.logs.map((log, i) => (
                  <CompactLogRow key={i} log={log} t={t} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? '#94a3b8';
  const labels: Record<string, string> = {
    pending: '대기', running: '실행 중', success: '성공',
    error: '실패', warning: '경고', skipped: '건너뜀',
  };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 10,
      background: `${color}20`, color,
      fontSize: 11, fontWeight: 500,
    }}>
      {status === 'running' && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
      {status === 'success' && <CheckCircle size={10} />}
      {status === 'error' && <XCircle size={10} />}
      {status === 'warning' && <AlertTriangle size={10} />}
      {labels[status] ?? status}
    </span>
  );
}

function LogPanel({ t, logs, logFilter, logLevelFilter, onFilterChange, onLevelToggle, logEndRef }: {
  t: ReturnType<typeof getTheme>;
  logs: (LogEntry & { source: string })[];
  logFilter: string;
  logLevelFilter: Set<string>;
  onFilterChange: (v: string) => void;
  onLevelToggle: (level: string) => void;
  logEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center',
        padding: '8px 12px', borderRadius: 8,
        background: t.bg, border: `1px solid ${t.divider}`,
      }}>
        <Search size={14} color={t.textMuted} />
        <input
          value={logFilter}
          onChange={e => onFilterChange(e.target.value)}
          placeholder="로그 검색..."
          style={{
            flex: 1, border: 'none', outline: 'none',
            background: 'transparent', color: t.text, fontSize: 13,
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {Object.entries(LOG_LEVEL_META).map(([level, meta]) => (
            <button
              key={level}
              onClick={() => onLevelToggle(level)}
              style={{
                padding: '2px 8px', borderRadius: 4, border: 'none',
                fontSize: 10, fontWeight: 600,
                background: logLevelFilter.has(level) ? meta.bg : 'transparent',
                color: logLevelFilter.has(level) ? meta.color : t.textMuted,
                cursor: 'pointer', opacity: logLevelFilter.has(level) ? 1 : 0.5,
              }}
            >{meta.label}</button>
          ))}
        </div>
      </div>

      {/* Log stream */}
      <div style={{
        flex: 1, overflow: 'auto', padding: 8,
        background: t.bg, borderRadius: 8,
        border: `1px solid ${t.divider}`,
        fontFamily: 'var(--font-mono), monospace', fontSize: 11,
      }}>
        {logs.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: t.textMuted }}>
            로그가 없습니다.
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '68px 46px 120px 1fr',
              gap: 8, padding: '2px 4px',
              borderBottom: `1px solid ${t.divider}22`,
              lineHeight: '18px',
            }}>
              <span style={{ color: t.textMuted }}>
                {new Date(log.timestamp).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                })}
              </span>
              <span style={{
                padding: '0 4px', borderRadius: 3,
                background: LOG_LEVEL_META[log.level]?.bg ?? 'transparent',
                color: LOG_LEVEL_META[log.level]?.color ?? t.textMuted,
                fontWeight: 600, textAlign: 'center',
              }}>
                {LOG_LEVEL_META[log.level]?.label ?? log.level}
              </span>
              <span style={{ color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {log.source}
              </span>
              <span style={{ color: t.text, wordBreak: 'break-word' }}>
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

function CompactLogRow({ log, t }: { log: LogEntry; t: ReturnType<typeof getTheme> }) {
  const meta = LOG_LEVEL_META[log.level] ?? LOG_LEVEL_META.info;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '68px 46px 1fr',
      gap: 8, padding: '1px 4px', fontSize: 11,
      fontFamily: 'var(--font-mono), monospace',
      lineHeight: '16px',
    }}>
      <span style={{ color: t.textMuted }}>
        {new Date(log.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })}
      </span>
      <span style={{
        padding: '0 4px', borderRadius: 3,
        background: meta.bg, color: meta.color,
        fontWeight: 600, textAlign: 'center',
      }}>{meta.label}</span>
      <span style={{ color: t.text }}>{log.message}</span>
    </div>
  );
}

function ProgressBar({ t, progress }: {
  t: ReturnType<typeof getTheme>;
  progress: TestGenProgress;
}) {
  return (
    <div style={{
      padding: '8px 20px',
      borderTop: `1px solid ${t.divider}`,
      background: t.bg,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4,
      }}>
        <Loader2 size={14} color="#6366f1" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {PHASE_LABELS[progress.phase] ?? progress.phase}
        </span>
        <span style={{ fontSize: 11, color: t.textMuted }}>
          {progress.message}
        </span>
        <span style={{ fontSize: 11, color: t.textMuted, marginLeft: 'auto' }}>
          {progress.progress}%
        </span>
      </div>
      <div style={{
        height: 3, borderRadius: 2,
        background: t.divider,
        overflow: 'hidden',
      }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress.progress}%` }}
          transition={{ duration: 0.3 }}
          style={{
            height: '100%', borderRadius: 2,
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
          }}
        />
      </div>
    </div>
  );
}

// ── CSS Animation ───────────────────────────────────────────────────────────
// Add this to globals.css or use styled-components
// @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
