import { EventType, type PipelineEvent } from './event-types';

export type ConversationItemKind =
  | 'plan'
  | 'progress'
  | 'approval'
  | 'artifact'
  | 'message'
  | 'warning'
  | 'complete'
  | 'error';

export interface ConversationItem {
  id: string;
  eventId: number;
  streamId: string;
  kind: ConversationItemKind;
  title: string;
  message: string;
  timestamp: string;
  phase?: string;
  data: Record<string, unknown>;
}

function classifyEvent(event: PipelineEvent): ConversationItemKind | null {
  const type = event.type;
  if (type === EventType.HEARTBEAT || type === EventType.AGENT_CHUNK || type === 'chunk') return null;
  if (type === EventType.STRUCTURE_PREVIEW || type === 'permission.request') return 'approval';
  if (
    type === 'artifact.created'
    || (type === EventType.PAGE_COMPLETED && Boolean(event.data.path ?? event.data.file ?? event.data.output_file))
  ) return 'artifact';
  if (
    type === EventType.ERROR
    || type === EventType.PIPELINE_FAILED
    || type === EventType.PHASE_FAILED
    || type === EventType.PAGE_FAILED
    || type === EventType.AGENT_ERROR
  ) return 'error';
  if (type === EventType.COMPLETE || type === EventType.PIPELINE_COMPLETED) return 'complete';
  if (type.includes('warning') || type === 'warn') return 'warning';
  if (type === EventType.PIPELINE_STARTED || type === 'assistant.plan') return 'plan';
  if (type === EventType.AGENT_RESPONSE || type === 'assistant.message') return 'message';
  return 'progress';
}

function titleFor(kind: ConversationItemKind, event: PipelineEvent): string {
  const phase = event.phase ? String(event.phase) : '';
  if (kind === 'plan') return '실행 계획';
  if (kind === 'approval') return '사용자 승인 필요';
  if (kind === 'artifact') return '산출물 생성';
  if (kind === 'warning') return '확인 필요';
  if (kind === 'complete') return '작업 완료';
  if (kind === 'error') return '작업 실패';
  if (kind === 'message') return 'AI 응답';
  return phase ? `${phase} 진행` : '작업 진행';
}

function projectEvent(event: PipelineEvent): ConversationItem | null {
  const kind = classifyEvent(event);
  if (!kind) return null;
  return {
    id: `${event.stream_id}:${event.id}`,
    eventId: event.id,
    streamId: event.stream_id,
    kind,
    title: titleFor(kind, event),
    message: event.message,
    timestamp: event.ts,
    phase: event.phase ? String(event.phase) : undefined,
    data: event.data ?? {},
  };
}

export function projectConversationEvents(
  events: PipelineEvent[],
  existing: ConversationItem[] = [],
): ConversationItem[] {
  const projected = new Map(existing.map((item) => [item.id, item]));
  for (const event of events) {
    const item = projectEvent(event);
    if (item) projected.set(item.id, item);
  }
  return [...projected.values()].sort(
    (left, right) => left.eventId - right.eventId || left.timestamp.localeCompare(right.timestamp),
  );
}
