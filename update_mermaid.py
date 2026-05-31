import sys

with open('src/components/Mermaid.tsx', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.startswith('import { RefreshCw } from \'lucide-react\';'):
        lines[i] = 'import { RefreshCw, X, Edit3 } from \'lucide-react\';\n'
    if line.startswith('  onFixError?: (chart: string) => Promise<void>;'):
        lines[i] = '  onFixError?: (chart: string, customPrompt?: string) => Promise<void>;\n'

# Find the start of the Mermaid component state
for i, line in enumerate(lines):
    if 'const [isFixing, setIsFixing] = useState(false);' in line:
        insert_idx = i + 1
        break

state_additions = """  const [showPromptModal, setShowPromptModal] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  const handleCustomFix = async (promptText: string) => {
    if (!onFixError) return;
    try {
      setIsFixing(true);
      setShowPromptModal(false);
      await onFixError(chart, promptText);
    } catch (e) {
      console.error(e);
    } finally {
      setIsFixing(false);
    }
  };
"""
lines.insert(insert_idx, state_additions)

# Find the render logic for normal diagrams
for i, line in enumerate(lines):
    if '<div className="absolute top-2 right-2 bg-gray-700/70' in line:
        render_insert_idx = i
        break

render_additions = """          {!zoomingEnabled && onFixError && (
            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-start gap-2 z-10">
              <button
                onClick={(e) => { e.stopPropagation(); setShowPromptModal(true); }}
                className="bg-[var(--accent-primary)]/90 hover:bg-[var(--accent-primary)] text-white p-1.5 rounded-md flex items-center gap-1.5 text-xs shadow-md transition-colors"
                disabled={isFixing}
              >
                <RefreshCw size={12} className={isFixing ? "animate-spin" : ""} />
                {isFixing ? "수정 중..." : "다이어그램 수정"}
              </button>
            </div>
          )}
          {showPromptModal && (
            <div className="absolute top-10 left-2 w-80 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 z-20 text-left" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1"><Edit3 size={12}/> 다이어그램 변경 요청</h4>
                <button onClick={() => setShowPromptModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  <X size={14} />
                </button>
              </div>
              <textarea 
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder="어떻게 변경할까요? (예: LR 방향으로 바꿔줘)"
                className="w-full h-20 p-2 text-xs border rounded-md dark:bg-[#2d2d2d] dark:border-gray-600 dark:text-gray-200 mb-2 resize-none"
              />
              <div className="flex flex-wrap gap-1 mb-2">
                <button onClick={() => handleCustomFix("다이어그램의 모든 내용을 한국어로 번역해줘")} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">🇰🇷 한국어로 번역</button>
                <button onClick={() => handleCustomFix("다이어그램의 방향을 왼쪽에서 오른쪽(LR)으로 변경해줘")} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">➡️ 가로(LR) 방향</button>
                <button onClick={() => handleCustomFix("이 다이어그램을 더 상세하고 구체적으로 확장해서 그려줘")} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">🔍 더 상세하게</button>
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={() => handleCustomFix(customPrompt)}
                  disabled={!customPrompt.trim()}
                  className="px-3 py-1.5 bg-[var(--accent-primary)] text-white text-xs rounded hover:opacity-90 disabled:opacity-50"
                >
                  수정 요청
                </button>
              </div>
            </div>
          )}
"""
lines.insert(render_insert_idx, render_additions)

with open('src/components/Mermaid.tsx', 'w') as f:
    f.writelines(lines)
