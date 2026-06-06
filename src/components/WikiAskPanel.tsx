"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, X, ArrowUp, Loader2, FileText } from "lucide-react";
import { getTheme } from "@/lib/theme";
import Markdown from "./Markdown";
import {
  askWiki,
  selectWikiContext,
  extractCitations,
  stripCitationMarkers,
  type AskTurn,
  type WikiPageLite,
  type GroundingResult,
} from "@/lib/wiki-ask";

interface WikiAskPanelProps {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
  wikiTitle: string;
  pages: WikiPageLite[];
  projectData: { owner?: string; repo?: string; repo_type?: string } | null;
  onCitationClick: (pageId: string) => void;
}

interface Message extends AskTurn {
  citations?: { title: string; id: string }[];
  grounding?: GroundingResult;
}

export function WikiAskPanel({
  open,
  onClose,
  isDark,
  wikiTitle,
  pages,
  projectData,
  onCitationClick,
}: WikiAskPanelProps) {
  const t = getTheme(isDark);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasWiki = pages.some((p) => p.content && p.content.trim());

  // Auto-scroll to bottom as content streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveAnswer, open]);

  // Abort any in-flight request when the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSend() {
    const question = input.trim();
    if (!question || streaming || !hasWiki) return;

    setErrorMsg(null);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const nextMessages: Message[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setLiveAnswer("");

    const controller = new AbortController();
    abortRef.current = controller;

    // P2: token guard — send the whole wiki if it fits, else the most relevant pages.
    const grounding = selectWikiContext(pages, question);

    try {
      const answer = await askWiki({
        projectData,
        wikiTitle,
        pages: grounding.pages,
        history,
        question,
        signal: controller.signal,
        onToken: (delta) => setLiveAnswer((prev) => prev + delta),
      });
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: answer,
          citations: extractCitations(answer, grounding.pages),
          grounding,
        },
      ]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
      setLiveAnswer("");
      abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 440, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 440, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          style={{
            width: 420,
            flexShrink: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: t.bg,
            borderLeft: `1px solid ${t.divider}`,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: `1px solid ${t.divider}`,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: t.aiLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkles size={15} color={t.ai} />
              </div>
              <span style={{ color: t.text, fontSize: 14, fontWeight: 600 }}>위키에 질문하기</span>
            </div>
            <button
              onClick={onClose}
              title="닫기"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: t.textSecondary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            {messages.length === 0 && !streaming && (
              <div style={{ color: t.textSecondary, fontSize: 13, lineHeight: 1.7, padding: "8px 4px" }}>
                {hasWiki ? (
                  <>
                    이 위키 문서를 근거로 답변합니다.
                    <br />
                    예: <em>“이 프로젝트의 인증 흐름은 어떻게 되나요?”</em>
                  </>
                ) : (
                  <>먼저 위키가 생성되어야 질문할 수 있습니다.</>
                )}
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                  <div
                    style={{
                      maxWidth: "85%",
                      background: t.userLight,
                      color: t.text,
                      padding: "8px 12px",
                      borderRadius: "12px 12px 4px 12px",
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ marginBottom: 18 }}>
                  {m.grounding?.strategy === "retrieved" && (
                    <div style={{ color: t.textMuted, fontSize: 11, marginBottom: 6 }}>
                      🔍 위키가 커서 전체 {m.grounding.totalPages}개 중 관련 {m.grounding.pages.length}개 문서를 골라 답변했습니다
                    </div>
                  )}
                  <div style={{ fontSize: 13.5, lineHeight: 1.65, color: t.text }}>
                    <Markdown content={stripCitationMarkers(m.content)} />
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {m.citations.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => onCitationClick(c.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 9px",
                            borderRadius: 8,
                            background: t.surface,
                            border: `1px solid ${t.divider}`,
                            cursor: "pointer",
                            color: t.textSecondary,
                            fontSize: 11.5,
                            fontFamily: "inherit",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = t.primaryLight;
                            e.currentTarget.style.color = t.primary;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = t.surface;
                            e.currentTarget.style.color = t.textSecondary;
                          }}
                        >
                          <FileText size={12} />
                          {c.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}

            {/* Live streaming answer */}
            {streaming && (
              <div style={{ marginBottom: 18 }}>
                {liveAnswer ? (
                  <div style={{ fontSize: 13.5, lineHeight: 1.65, color: t.text }}>
                    <Markdown content={stripCitationMarkers(liveAnswer)} />
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, color: t.textSecondary, fontSize: 13 }}>
                    <Loader2 size={14} className="animate-spin" />
                    위키를 읽고 답변을 작성 중…
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div
                style={{
                  background: t.errorLight,
                  color: t.error,
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  marginBottom: 12,
                }}
              >
                {errorMsg}
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${t.divider}`, flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 8,
                background: t.surface,
                borderRadius: 12,
                padding: "8px 8px 8px 12px",
                border: `1px solid ${t.divider}`,
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!hasWiki || streaming}
                placeholder={hasWiki ? "위키 내용에 대해 질문하세요…" : "위키 생성 후 이용 가능"}
                rows={1}
                style={{
                  flex: 1,
                  resize: "none",
                  maxHeight: 120,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: t.text,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                  padding: "4px 0",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || streaming || !hasWiki}
                title="보내기 (Enter)"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  border: "none",
                  flexShrink: 0,
                  cursor: input.trim() && !streaming && hasWiki ? "pointer" : "not-allowed",
                  background: input.trim() && !streaming && hasWiki ? t.primary : t.surfaceHover,
                  color: input.trim() && !streaming && hasWiki ? "#fff" : t.textMuted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                }}
              >
                {streaming ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
              </button>
            </div>
            <div style={{ color: t.textMuted, fontSize: 10.5, marginTop: 6, textAlign: "center" }}>
              생성된 위키 문서를 근거로 답변합니다 · 답변이 부정확할 수 있습니다
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
