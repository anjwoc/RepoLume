'use client';

import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, FileCode2, FolderTree } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function DeepWikiPanel() {
  const searchParams = useSearchParams();
  const deepwikiUrl = searchParams.get("deepwikiUrl");
  
  if (deepwikiUrl) {
    return (
      <div className="flex flex-col h-full w-full bg-slate-50 dark:bg-zinc-950 items-center justify-center p-8">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-sm p-8 text-center space-y-4">
           <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <FolderTree className="w-8 h-8" />
           </div>
           <h2 className="text-xl font-bold text-slate-900 dark:text-white">Original DeepWiki</h2>
           <p className="text-sm text-slate-500 dark:text-slate-400">
             DeepWiki.com does not allow embedding due to Content Security Policy restrictions.
           </p>
           <a href={deepwikiUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors mt-4">
              Open DeepWiki in New Tab <ChevronRight className="w-4 h-4" />
           </a>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-zinc-950 border-r border-slate-200 dark:border-zinc-800 font-sans">
      {/* Header */}
      <div className="h-14 border-b border-slate-200 dark:border-zinc-800 flex items-center px-4 bg-white dark:bg-zinc-900 shadow-sm z-10">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
          <span className="font-semibold text-slate-800 dark:text-slate-200">DeepWiki</span>
          <ChevronRight className="w-4 h-4" />
          <span>microsoft/vscode</span>
          <ChevronRight className="w-4 h-4" />
          <span className="text-slate-900 dark:text-white font-medium">MCP Integration</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Mockup */}
        <div className="w-64 border-r border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hidden md:block">
          <ScrollArea className="h-full py-4">
            <div className="px-4 mb-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Architecture
            </div>
            <div className="space-y-1 px-2">
              <SidebarItem icon={<FolderTree />} text="1. Overview" />
              <SidebarItem icon={<FolderTree />} text="2. Electron Main" />
              <SidebarItem icon={<FolderTree />} text="3. Workbench UI" />
              <SidebarItem icon={<FolderTree />} text="4. Monaco Editor" />
              <SidebarItem icon={<FolderTree />} text="5. Extension System" />
              <SidebarItem icon={<FolderTree />} text="6. Terminal" />
              <SidebarItem icon={<FolderTree />} text="7. AI and Copilot" active />
              <div className="pl-6 space-y-1 mt-1">
                <SidebarItem icon={<FileCode2 />} text="7.1 Chat Service" />
                <SidebarItem icon={<FileCode2 />} text="7.4 Agent Orchestration" />
                <SidebarItem icon={<FileCode2 />} text="7.7 MCP Integration" active />
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Content Mockup */}
        <ScrollArea className="flex-1 bg-white dark:bg-zinc-950 p-8">
          <div className="max-w-3xl mx-auto space-y-6 text-slate-700 dark:text-slate-300">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">7.7 MCP Integration</h1>
            
            <p className="leading-relaxed">
              Visual Studio Code supports the Model Context Protocol (MCP) to allow AI models to interact with local tools and resources. The integration spans across multiple layers of the application.
            </p>

            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mt-8 mb-4 border-b pb-2 dark:border-zinc-800">Key Components</h2>
            
            <div className="space-y-4">
              <div className="p-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50">
                <h3 className="font-mono text-sm text-blue-600 dark:text-blue-400 font-semibold mb-2">mainThreadMcp.ts</h3>
                <p className="text-sm">Manages the central state between UI/Agent layers and the actual MCP connections in the Extension Host.</p>
              </div>
              
              <div className="p-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50">
                <h3 className="font-mono text-sm text-blue-600 dark:text-blue-400 font-semibold mb-2">extHostMcp.ts</h3>
                <p className="text-sm">Instantiates the actual MCP client and communicates over RPC from the main thread.</p>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50">
                <h3 className="font-mono text-sm text-blue-600 dark:text-blue-400 font-semibold mb-2">claudeAgent.ts</h3>
                <p className="text-sm">Wraps the Anthropic Claude Agent SDK and projects it into a VSCode session. Handles permissions via canUseTool.</p>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mt-8 mb-4 border-b pb-2 dark:border-zinc-800">Authentication Tracker</h2>
            <pre className="p-4 rounded-lg bg-slate-100 dark:bg-zinc-900 text-sm font-mono overflow-x-auto text-slate-800 dark:text-slate-300">
              {`class McpServerAuthTracker {
  private readonly _tracking = new Map<
    string, 
    Array<{ serverId: number; scopes: string[] }>
  >();
}`}
            </pre>
            <p className="text-sm mt-4 text-slate-500 dark:text-slate-400 italic">
              * Note: DeepWiki provides static structural summaries based on class names and directory layouts.
            </p>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function SidebarItem({ icon, text, active = false }: { icon: React.ReactNode, text: string, active?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800/50'}`}>
      <span className="[&>svg]:w-4 [&>svg]:h-4 opacity-70">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  );
}
