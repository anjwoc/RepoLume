"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, X, ArrowUp, Loader2, FileText } from "lucide-react";
import { getTheme } from "@/lib/theme";
import Markdown from "./Markdown";
import {
  askWiki,
  askWikiSemantic,
  checkWikiRagHealth,
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
  semantic?: boolean;
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
  const [semantic, setSemantic] = useState(false); // P3: 의미 검색(임베딩) 모드
  const [ragAlert, setRagAlert] = useState(false); // Ollama 미설치 안내 표시
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

    try {
      let assistantMsg: Message;
      if (semantic) {
        // P3: backend embeds the whole wiki (Ollama) and retrieves the relevant chunks.
        const answer = await askWikiSemantic({
          wikiTitle,
          pages,
          history,
          question,
          signal: controller.signal,
          onToken: (delta) => setLiveAnswer((prev) => prev + delta),
        });
        assistantMsg = {
          role: "assistant",
          content: answer,
          citations: extractCitations(answer, pages),
          semantic: true,
        };
      } else {
        // P2: token guard — whole wiki if it fits, else the most relevant pages (client-side).
        const grounding = selectWikiContext(pages, question);
        const answer = await askWiki({
          projectData,
          wikiTitle,
          pages: grounding.pages,
          history,
          question,
          signal: controller.signal,
          onToken: (delta) => setLiveAnswer((prev) => prev + delta),
        });
        assistantMsg = {
          role: "assistant",
          content: answer,
          citations: extractCitations(answer, grounding.pages),
          grounding,
        };
      }
      setMessages([...nextMessages, assistantMsg]);
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

  // Toggle semantic mode, but verify Ollama is available before enabling it.
  async function toggleSemantic() {
    if (streaming) return;
    if (semantic) {
      setSemantic(false);
      setRagAlert(false);
      return;
    }
    const health = await checkWikiRagHealth();
    if (health.available) {
      setSemantic(true);
      setRagAlert(false);
    } else {
      setSemantic(false);
      setRagAlert(true); // show install guidance
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
                  {m.semantic && (
                    <div style={{ color: t.textMuted, fontSize: 11, marginBottom: 6 }}>
                      🧠 의미 검색(로컬 임베딩)으로 관련 문서를 찾아 답변했습니다
                    </div>
                  )}
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
            {ragAlert && (
              <div
                style={{
                  background: t.warningLight,
                  color: t.warning,
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>정밀 검색에는 로컬 Ollama가 필요합니다</strong>
                  <button
                    onClick={() => setRagAlert(false)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: t.warning, padding: 0, lineHeight: 1 }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div style={{ marginTop: 4, color: t.textSecondary }}>
                  의미 기반(임베딩) RAG는 Ollama가 있어야 동작합니다. 설치 후 다시 켜주세요:
                  <div style={{ marginTop: 4, fontFamily: "monospace", color: t.text }}>
                    brew install ollama
                    <br />
                    ollama serve
                    <br />
                    ollama pull nomic-embed-text
                  </div>
                  <div style={{ marginTop: 4 }}>설치 전에는 기본(키워드) 검색으로 계속 질문할 수 있습니다.</div>
                </div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 8 }}>
              <button
                onClick={toggleSemantic}
                disabled={streaming}
                title="로컬 임베딩(Ollama)으로 의미 기반 검색 — 큰 위키에 유리"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  borderRadius: 8,
                  border: `1px solid ${semantic ? t.ai : t.divider}`,
                  background: semantic ? t.aiLight : "transparent",
                  color: semantic ? t.ai : t.textSecondary,
                  cursor: streaming ? "not-allowed" : "pointer",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                <Sparkles size={12} />
                정밀 검색 {semantic ? "ON" : "OFF"}
              </button>
            </div>
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
