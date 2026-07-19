import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { DiagramShowcase } from './DiagramShowcase'

export const metadata: Metadata = {
  title: 'RepoLume — VSCode Architecture',
  description: '30 pages of architectural docs generated from a production codebase. Gemini 3.5 Flash, runs locally.',
}

const WIKI_HREF = '/wiki/local/vscode?repo_type=local&language=ko&languages=ko&model=agy-gemini-3.5-flash-high&id=repolume_cache_local_local_vscode_ko_agy-gemini-3.5-flash-high.json'

const PAGES = [
  { section: 'Getting Started', items: ['Overview', 'Developer Setup', 'Basic Usage', 'Quick Reference'] },
  { section: 'Onboarding', items: ['Zero to Hero', 'Principal Guide', 'CLI Launcher', 'Usage Models'] },
  { section: 'System Analysis', items: ['Business Flow', 'Data Flow', 'Debug Flow', 'Change Impact', 'Monitoring Points', 'Service Map'] },
  { section: 'Deep Dive', items: ['BYOK Engines', 'Chat Sessions', 'Rust CLI', 'Tunnels', 'TypeScript Extension', 'Completions', 'Chronicle Telemetry', 'Methods'] },
]

export default function ComparePage() {
  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">

      {/* Hero */}
      <section className="min-h-[100dvh] flex flex-col justify-center px-6 md:px-16 max-w-5xl mx-auto">
        <p className="text-xs font-mono text-zinc-600 mb-6 tracking-widest uppercase">
          DeepWiki는 설명한다. RepoLume는 보여준다.
        </p>

        <h1 className="text-6xl md:text-8xl font-bold tracking-tighter leading-[0.95] text-white mb-8">
          30 pages.<br />
          <span className="text-zinc-500">Gemini Flash.</span>
        </h1>

        <p className="text-zinc-400 text-lg max-w-[44ch] mb-10 leading-relaxed">
          VS Code extension 코드베이스 전체를 분석해서 아키텍처 다이어그램, 데이터 플로우, 디버깅 가이드까지 — 로컬에서, 30분 안에.
        </p>

        <div className="flex items-center gap-4">
          <Link
            href={WIKI_HREF}
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold transition-colors active:scale-[0.98]"
          >
            위키 보기 <ArrowRight size={16} />
          </Link>
          <span className="text-zinc-600 text-sm font-mono">4 sections · 30 pages</span>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30">
          <div className="w-px h-12 bg-zinc-600 animate-pulse" />
        </div>
      </section>

      {/* Diagram — the evidence */}
      <section className="px-6 md:px-16 max-w-5xl mx-auto pb-24">
        <DiagramShowcase />
      </section>

      {/* Page index — raw proof */}
      <section className="px-6 md:px-16 max-w-5xl mx-auto pb-32">
        <div className="border-t border-zinc-800 pt-16">
          <p className="text-xs font-mono text-zinc-600 mb-10 tracking-widest uppercase">
            생성된 문서 목록
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {PAGES.map(({ section, items }) => (
              <div key={section}>
                <p className="text-xs font-mono text-emerald-600 mb-3 uppercase tracking-wider">{section}</p>
                <ul className="space-y-1.5">
                  {items.map(item => (
                    <li key={item} className="text-sm text-zinc-500">{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-900 px-6 py-24 text-center">
        <Link
          href={WIKI_HREF}
          className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-white font-semibold text-lg transition-colors"
        >
          VSCode 위키 열기 <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  )
}
