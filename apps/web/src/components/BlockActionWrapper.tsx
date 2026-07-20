"use client";

import React, { useState, useRef } from "react";
import { GripVertical, Trash2, Sparkles, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type BlockActionType = "fix" | "delete";

interface BlockActionWrapperProps {
  children: React.ReactNode;
  blockContent: string;
  startLine?: number;
  endLine?: number;
  onBlockAction?: (
    type: BlockActionType,
    blockContent: string,
    startLine?: number,
    endLine?: number,
    prompt?: string
  ) => Promise<void>;
  hoverBgColor?: string;
}

export function BlockActionWrapper({
  children,
  blockContent,
  startLine,
  endLine,
  onBlockAction,
  hoverBgColor,
}: BlockActionWrapperProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showFixDialog, setShowFixDialog] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  if (!onBlockAction) {
    return <>{children}</>;
  }

  const handleDelete = async () => {
    await onBlockAction("delete", blockContent, startLine, endLine);
  };

  const handleFix = async () => {
    const prompt = promptRef.current?.value?.trim();
    if (!prompt) return;
    setIsFixing(true);
    try {
      await onBlockAction("fix", blockContent, startLine, endLine, prompt);
      setShowFixDialog(false);
      if (promptRef.current) promptRef.current.value = "";
    } catch (e) {
      console.error(e);
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <>
      <div
        className="relative group/block -ml-14 pl-14"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Notion-style grip handle – shows on hover, positioned left of content */}
        <div
          className="absolute left-4 top-0.5 flex items-start"
          style={{
            opacity: isHovered ? 1 : 0,
            transition: "opacity 0.15s ease",
            pointerEvents: isHovered ? "auto" : "none",
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-0.5 rounded-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                aria-label="Block actions"
                title="클릭하여 블록 옵션 열기"
              >
                <GripVertical size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={4}
              className="w-48 shadow-lg"
            >
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-sm"
                onClick={() => setShowFixDialog(true)}
              >
                <Sparkles size={14} className="text-blue-500" />
                AI에게 수정 요청
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-sm text-red-500 focus:text-red-500"
                onClick={handleDelete}
              >
                <Trash2 size={14} />
                이 블록 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Content */}
        <div
          className="rounded-[4px] transition-colors duration-100 ease-in-out"
          style={{
            backgroundColor: isHovered ? (hoverBgColor || "rgba(60,130,246,0.06)") : "transparent",
          }}
        >
          {children}
        </div>
      </div>

      {/* AI Fix Dialog */}
      <Dialog open={showFixDialog} onOpenChange={setShowFixDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={16} className="text-blue-500" />
              AI에게 이 블록 수정 요청
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              아래에 수정 지시사항을 입력하면 AI가 해당 블록만 변경합니다.
            </DialogDescription>
          </DialogHeader>

          {/* Block preview */}
          <div className="rounded-md bg-muted/60 border border-border px-3 py-2 max-h-28 overflow-y-auto">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
              {blockContent.length > 300
                ? blockContent.slice(0, 300) + "…"
                : blockContent}
            </pre>
          </div>

          <Textarea
            ref={promptRef}
            placeholder="예: 한국어로 번역해줘 / 더 간결하게 요약해줘 / 이 내용을 표 형식으로 바꿔줘"
            rows={3}
            className="text-sm resize-none"
            disabled={isFixing}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                handleFix();
              }
            }}
          />

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFixDialog(false)}
              disabled={isFixing}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleFix}
              disabled={isFixing}
              className="gap-1.5"
            >
              {isFixing ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  수정 중…
                </>
              ) : (
                <>
                  <Sparkles size={13} />
                  수정 요청 (⌘↵)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
