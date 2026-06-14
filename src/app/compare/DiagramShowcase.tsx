'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import dynamic from 'next/dynamic'

const Mermaid = dynamic(() => import('@/components/Mermaid'), { ssr: false, loading: () => (
  <div className="flex items-center justify-center h-64">
    <div className="flex gap-1.5">
      {[0,1,2].map(i => (
        <div key={i} className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  </div>
) })

const TABS = [
  {
    id: 'service',
    label: 'Service Map',
    desc: 'Component dependency graph across the entire runtime stack',
    chart: `graph TD
    subgraph A [Local Client]
        VSCode[VS Code Extension]
        RustCLI[Rust CLI Launcher]
        RPCBridge[RPC Protocol Bridge]
    end
    subgraph B [Agent Runtime]
        AgentSDK[Claude Agent SDK]
        BYOK[BYOK Adapters]
    end
    subgraph C [External]
        LLM[LLM Providers]
    end
    VSCode -->|IPC| RustCLI
    RustCLI <-->|RPC| RPCBridge
    RPCBridge <-->|Secure Tunnel| AgentSDK
    AgentSDK -->|Internal| BYOK
    BYOK -->|HTTPS TLS 1.3| LLM`,
  },
  {
    id: 'flow',
    label: 'Data Flow',
    desc: 'End-to-end data pipeline from user input to LLM response',
    chart: `graph LR
    subgraph In [Input Layer]
        UI[VS Code Chat UI]
        Ctx[Context Collector]
    end
    subgraph Proc [Processing]
        SDK[Agent SDK]
        BYOK[BYOK Adapters]
        Store[(Session Store)]
    end
    subgraph Out [LLM Layer]
        LLM[Anthropic Claude]
    end
    UI -->|User message| SDK
    Ctx -->|File context| SDK
    SDK -->|Read/Write| Store
    SDK -->|Normalize payload| BYOK
    BYOK -->|POST completions| LLM
    LLM -->|SSE stream| BYOK
    BYOK -->|Agent message| SDK
    SDK -->|Render| UI`,
  },
  {
    id: 'debug',
    label: 'Debug Sequence',
    desc: 'Failure propagation paths with error codes at each layer',
    chart: `sequenceDiagram
    autonumber
    participant VS as VS Code
    participant Br as RPC Bridge
    participant CLI as Rust CLI
    participant SDK as Agent SDK
    participant BK as BYOK
    participant API as LLM Provider
    VS->>Br: Send Action Request
    Note over Br: Check Connection
    rect rgb(60,20,20)
        Note over Br,CLI: Tunnel Disconnected
        Br-->>VS: RPC_BRIDGE_TUNNEL_DISCONNECTED
    end
    Br->>CLI: Forward via Tunnels
    CLI->>SDK: Init Chat Session
    rect rgb(60,20,20)
        Note over SDK,BK: Invalid API Key
        SDK->>BK: Request Token Auth
        BK-->>SDK: 401 Unauthorized
        SDK-->>VS: AUTH_ADAPTER_REJECTED
    end
    BK->>API: POST /completions
    rect rgb(60,20,20)
        Note over API: Rate Limit 429
        API-->>BK: Too Many Requests
        BK-->>SDK: Exponential Backoff
        SDK-->>VS: PROVIDER_RATE_LIMIT_EXCEEDED
    end`,
  },
]

export function DiagramShowcase() {
  const [active, setActive] = useState(0)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold: 0.1 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={visible ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800 mb-6 w-fit">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setActive(i)}
            className="relative px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ color: active === i ? '#10b981' : '#71717a' }}
          >
            {active === i && (
              <motion.div
                layoutId="tab-bg"
                className="absolute inset-0 rounded-lg bg-zinc-800"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Diagram panel */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-3">
          <div className="flex gap-1.5">
            {['#ef4444','#f59e0b','#10b981'].map(c => (
              <div key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />
            ))}
          </div>
          <span className="text-xs font-mono text-zinc-500">
            localwiki / vscode / system_analysis / {TABS[active].id}.md
          </span>
        </div>

        <div className="p-2 text-xs text-zinc-500 px-6 pt-4 pb-0">
          {TABS[active].desc}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="p-6 min-h-[360px] bg-white/[0.02]"
          >
            <Mermaid chart={TABS[active].chart} />
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
