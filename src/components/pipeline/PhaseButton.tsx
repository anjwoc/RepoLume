"use client";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { AnalysisPhase } from "@/lib/stream-types";
import { getPhaseStatusIcon } from "@/lib/analysis-utils";
import { getTheme } from "@/lib/theme";

interface PhaseButtonProps {
  phase: AnalysisPhase;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  theme: ReturnType<typeof getTheme>;
}

export function PhaseButton({ phase, isActive, isExpanded, onToggle, theme: t }: PhaseButtonProps) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "10px 8px",
        borderRadius: 10,
        background: isActive ? t.primaryLight : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        marginBottom: 4,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = t.surfaceHover; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ paddingTop: 2 }}>
        {getPhaseStatusIcon(phase.status, t)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <span style={{
            color: phase.status === "completed" ? t.success : isActive ? t.primary : t.text,
            fontSize: 13,
            fontWeight: 500,
          }}>
            {phase.name}
          </span>
          {phase.logs.length > 0 && (
            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} color={t.textMuted} />
            </motion.div>
          )}
        </div>
        <p style={{ color: t.textMuted, fontSize: 11, margin: 0, lineHeight: 1.4 }}>
          {phase.description}
        </p>
        {phase.status === "in_progress" && (
          <div style={{ marginTop: 8, height: 3, background: t.divider, borderRadius: 999, overflow: "hidden" }}>
            <motion.div
              animate={{ width: `${phase.progress}%` }}
              transition={{ duration: 0.3 }}
              style={{ height: "100%", background: t.primary, borderRadius: 999 }}
            />
          </div>
        )}
      </div>
    </button>
  );
}
