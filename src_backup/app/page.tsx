'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FaBitbucket,
  FaCheckCircle,
  FaCog,
  FaFolderOpen,
  FaGithub,
  FaGitlab,
  FaHistory,
  FaLock,
  FaPlay,
  FaProjectDiagram,
  FaSearch,
  FaSlidersH,
  FaTerminal,
  FaWikipediaW,
} from 'react-icons/fa';
import ThemeToggle from '@/components/theme-toggle';
import ConfigurationModal from '@/components/ConfigurationModal';
import ProcessedProjects from '@/components/ProcessedProjects';
import { extractUrlPath, extractUrlDomain } from '@/utils/urlDecoder';
import { useProcessedProjects } from '@/hooks/useProcessedProjects';

import { useLanguage } from '@/contexts/LanguageContext';

export default function Home() {
  const router = useRouter();
  const { language, setLanguage, messages, supportedLanguages } = useLanguage();
  const { projects, isLoading: projectsLoading } = useProcessedProjects();

  // Create a simple translation function
  const t = (key: string, params: Record<string, string | number> = {}): string => {
    // Split the key by dots to access nested properties
    const keys = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let value: any = messages;

    // Navigate through the nested properties
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        // Return the key if the translation is not found
        return key;
      }
    }

    // If the value is a string, replace parameters
    if (typeof value === 'string') {
      return Object.entries(params).reduce((acc: string, [paramKey, paramValue]) => {
        return acc.replace(`{${paramKey}}`, String(paramValue));
      }, value);
    }

    // Return the key if the value is not a string
    return key;
  };

  const [repositoryInput, setRepositoryInput] = useState('https://github.com/localwiki');

  const REPO_CONFIG_CACHE_KEY = 'localwikiRepoConfigCache';

  const loadConfigFromCache = (repoUrl: string) => {
    if (!repoUrl) return;
    try {
      const cachedConfigs = localStorage.getItem(REPO_CONFIG_CACHE_KEY);
      if (cachedConfigs) {
        const configs = JSON.parse(cachedConfigs);
        const config = configs[repoUrl.trim()];
        if (config) {
          setSelectedLanguage(config.selectedLanguage || language);
          setIsComprehensiveView(config.isComprehensiveView === undefined ? true : config.isComprehensiveView);
          setProvider(config.provider || '');
          setModel(config.model || '');
          setIsCustomModel(config.isCustomModel || false);
          setCustomModel(config.customModel || '');
          setSelectedPlatform(config.selectedPlatform || 'github');
          setExcludedDirs(config.excludedDirs || '');
          setExcludedFiles(config.excludedFiles || '');
          setIncludedDirs(config.includedDirs || '');
          setIncludedFiles(config.includedFiles || '');
        }
      }
    } catch (error) {
      console.error('Error loading config from localStorage:', error);
    }
  };

  const handleRepositoryInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newRepoUrl = e.target.value;
    setRepositoryInput(newRepoUrl);
    if (newRepoUrl.trim() === "") {
      // Optionally reset fields if input is cleared
    } else {
        loadConfigFromCache(newRepoUrl);
    }
  };

  useEffect(() => {
    if (repositoryInput) {
      loadConfigFromCache(repositoryInput);
    }
  }, []);

  // Provider-based model selection state
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [customModel, setCustomModel] = useState<string>('');

  // Wiki type state - default to comprehensive view
  const [isComprehensiveView, setIsComprehensiveView] = useState<boolean>(true);

  const [excludedDirs, setExcludedDirs] = useState('');
  const [excludedFiles, setExcludedFiles] = useState('');
  const [includedDirs, setIncludedDirs] = useState('');
  const [includedFiles, setIncludedFiles] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<'github' | 'gitlab' | 'bitbucket'>('github');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(language);

  // Authentication state
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authCode, setAuthCode] = useState<string>('');
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  // Sync the language context with the selectedLanguage state
  useEffect(() => {
    setLanguage(selectedLanguage);
  }, [selectedLanguage, setLanguage]);

  // Fetch authentication status on component mount
  useEffect(() => {
    const fetchAuthStatus = async () => {
      try {
        setIsAuthLoading(true);
        const response = await fetch('/api/auth/status');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setAuthRequired(data.auth_required);
      } catch (err) {
        console.error("Failed to fetch auth status:", err);
        // Assuming auth is required if fetch fails to avoid blocking UI for safety
        setAuthRequired(true);
      } finally {
        setIsAuthLoading(false);
      }
    };

    fetchAuthStatus();
  }, []);

  // Parse repository URL/input and extract owner and repo
  const parseRepositoryInput = (input: string): {
    owner: string,
    repo: string,
    type: string,
    fullPath?: string,
    localPath?: string
  } | null => {
    input = input.trim();

    let owner = '', repo = '', type = 'github', fullPath;
    let localPath: string | undefined;

    // Handle Windows absolute paths (e.g., C:\path\to\folder)
    const windowsPathRegex = /^[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*$/;
    const customGitRegex = /^(?:https?:\/\/)?([^\/]+)\/(.+?)\/([^\/]+)(?:\.git)?\/?$/;

    if (windowsPathRegex.test(input)) {
      type = 'local';
      localPath = input;
      repo = input.split('\\').pop() || 'local-repo';
      owner = 'local';
    }
    // Handle Unix/Linux absolute paths (e.g., /path/to/folder)
    else if (input.startsWith('/')) {
      type = 'local';
      localPath = input;
      repo = input.split('/').filter(Boolean).pop() || 'local-repo';
      owner = 'local';
    }
    else if (customGitRegex.test(input)) {
      // Detect repository type based on domain
      const domain = extractUrlDomain(input);
      if (domain?.includes('github.com')) {
        type = 'github';
      } else if (domain?.includes('gitlab.com') || domain?.includes('gitlab.')) {
        type = 'gitlab';
      } else if (domain?.includes('bitbucket.org') || domain?.includes('bitbucket.')) {
        type = 'bitbucket';
      } else {
        type = 'web'; // fallback for other git hosting services
      }

      fullPath = extractUrlPath(input)?.replace(/\.git$/, '');
      const parts = fullPath?.split('/') ?? [];
      if (parts.length >= 2) {
        repo = parts[parts.length - 1] || '';
        owner = parts[parts.length - 2] || '';
      }
    }
    // Unsupported URL formats
    else {
      console.error('Unsupported URL format:', input);
      return null;
    }

    if (!owner || !repo) {
      return null;
    }

    // Clean values
    owner = owner.trim();
    repo = repo.trim();

    // Remove .git suffix if present
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    return { owner, repo, type, fullPath, localPath };
  };

  // State for configuration modal
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Parse repository input to validate
    const parsedRepo = parseRepositoryInput(repositoryInput);

    if (!parsedRepo) {
      setError('Invalid repository format. Use "owner/repo", GitHub/GitLab/BitBucket URL, or a local folder path like "/path/to/folder" or "C:\\path\\to\\folder".');
      return;
    }

    // If valid, open the configuration modal
    setError(null);
    setIsConfigModalOpen(true);
  };

  const validateAuthCode = async () => {
    try {
      if(authRequired) {
        if(!authCode) {
          return false;
        }
        const response = await fetch('/api/auth/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({'code': authCode})
        });
        if (!response.ok) {
          return false;
        }
        const data = await response.json();
        return data.success || false;
      }
    } catch {
      return false;
    }
    return true;
  };

  const handleGenerateWiki = async () => {

    // Check authorization code
    const validation = await validateAuthCode();
    if(!validation) {
      setError(`Failed to validate the authorization code`);
      console.error(`Failed to validate the authorization code`);
      setIsConfigModalOpen(false);
      return;
    }

    // Prevent multiple submissions
    if (isSubmitting) {
      console.log('Form submission already in progress, ignoring duplicate click');
      return;
    }

    try {
      const currentRepoUrl = repositoryInput.trim();
      if (currentRepoUrl) {
        const existingConfigs = JSON.parse(localStorage.getItem(REPO_CONFIG_CACHE_KEY) || '{}');
        const configToSave = {
          selectedLanguage,
          isComprehensiveView,
          provider,
          model,
          isCustomModel,
          customModel,
          selectedPlatform,
          excludedDirs,
          excludedFiles,
          includedDirs,
          includedFiles,
        };
        existingConfigs[currentRepoUrl] = configToSave;
        localStorage.setItem(REPO_CONFIG_CACHE_KEY, JSON.stringify(existingConfigs));
      }
    } catch (error) {
      console.error('Error saving config to localStorage:', error);
    }

    setIsSubmitting(true);

    // Parse repository input
    const parsedRepo = parseRepositoryInput(repositoryInput);

    if (!parsedRepo) {
      setError('Invalid repository format. Use "owner/repo", GitHub/GitLab/BitBucket URL, or a local folder path like "/path/to/folder" or "C:\\path\\to\\folder".');
      setIsSubmitting(false);
      return;
    }

    const { owner, repo, type, localPath } = parsedRepo;

    // Store tokens in query params if they exist
    const params = new URLSearchParams();
    if (accessToken) {
      params.append('token', accessToken);
    }
    // Always include the type parameter
    params.append('type', (type == 'local' ? type : selectedPlatform) || 'github');
    // Add local path if it exists
    if (localPath) {
      params.append('local_path', encodeURIComponent(localPath));
    } else {
      params.append('repo_url', encodeURIComponent(repositoryInput));
    }
    // Add model parameters
    params.append('provider', provider);
    params.append('model', model);
    if (isCustomModel && customModel) {
      params.append('custom_model', customModel);
    }
    // Add file filters configuration
    if (excludedDirs) {
      params.append('excluded_dirs', excludedDirs);
    }
    if (excludedFiles) {
      params.append('excluded_files', excludedFiles);
    }
    if (includedDirs) {
      params.append('included_dirs', includedDirs);
    }
    if (includedFiles) {
      params.append('included_files', includedFiles);
    }

    // Add language parameter
    params.append('language', selectedLanguage);

    // Add comprehensive parameter
    params.append('comprehensive', isComprehensiveView.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';

    // Navigate to the dynamic route
    router.push(`/${owner}/${repo}${queryString}`);

    // The isSubmitting state will be reset when the component unmounts during navigation
  };

  const quickInputs = [
    { label: 'Local path', value: '/Users/jcjeong/lab/code-sonar/local-deepwiki', icon: FaFolderOpen },
    { label: 'GitHub', value: 'https://github.com/localwiki', icon: FaGithub },
    { label: 'GitLab', value: 'https://gitlab.com/gitlab-org/gitlab', icon: FaGitlab },
    { label: 'Bitbucket', value: 'https://bitbucket.org/atlassian/atlaskit', icon: FaBitbucket },
  ];
  const parsedPreview = parseRepositoryInput(repositoryInput);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border-color)] bg-[var(--card-bg)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-white shadow-custom">
              <FaWikipediaW />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight">{t('common.appName')}</h1>
              <p className="truncate text-xs text-[var(--muted)]">{t('common.tagline')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/wiki/projects"
              className="hidden rounded-md border border-[var(--border-color)] px-3 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] sm:inline-flex"
            >
              {t('nav.wikiProjects')}
            </Link>
            <button
              type="button"
              onClick={handleFormSubmit}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            >
              <FaSlidersH />
              Settings
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-64px)] max-w-[1440px] grid-cols-1 gap-6 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="flex min-h-[620px] flex-col justify-between rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-custom">
          <div className="border-b border-[var(--border-color)] p-5 md:p-7">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)]">
                  <FaTerminal className="text-[var(--accent-primary)]" />
                  Workspace
                </div>
                <h2 className="max-w-2xl text-3xl font-semibold tracking-normal md:text-5xl">
                  Repository wiki
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                <div className="rounded-md border border-[var(--border-color)] bg-[var(--surface)] px-3 py-2">
                  <FaProjectDiagram className="mb-2 text-[var(--accent-primary)]" />
                  Diagrams
                </div>
                <div className="rounded-md border border-[var(--border-color)] bg-[var(--surface)] px-3 py-2">
                  <FaCheckCircle className="mb-2 text-[var(--success)]" />
                  Cache
                </div>
              </div>
            </div>

            <form onSubmit={handleFormSubmit} className="rounded-lg border border-[var(--border-color)] bg-[var(--surface)] p-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="relative flex-1">
                  <FaSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={repositoryInput}
                    onChange={handleRepositoryInputChange}
                    placeholder={t('form.repoPlaceholder') || 'Git URL, owner/repo, or /absolute/local/path'}
                    className="h-12 w-full rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] pl-11 pr-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent-primary)]"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--accent-primary)] px-5 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                >
                  <FaPlay className="text-xs" />
                  {isSubmitting ? t('common.processing') : t('common.generateWiki')}
                </button>
              </div>
              {error && <div className="mt-3 text-xs text-[var(--highlight)]">{error}</div>}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                {parsedPreview ? (
                  <span className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-2.5 py-1.5">
                    {parsedPreview.type === 'local' ? <FaFolderOpen /> : <FaGithub />}
                    {parsedPreview.owner}/{parsedPreview.repo} · {parsedPreview.type}
                  </span>
                ) : (
                  <span>No repository selected.</span>
                )}
                {authRequired && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-1.5 text-[var(--warning)]">
                    <FaLock /> Auth code required
                  </span>
                )}
              </div>
            </form>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {quickInputs.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setRepositoryInput(item.value);
                      loadConfigFromCache(item.value);
                    }}
                    className="flex min-w-0 items-center gap-3 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <Icon className="shrink-0 text-[var(--accent-primary)]" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--foreground)]">{item.label}</span>
                      <span className="block truncate font-mono text-[11px] text-[var(--muted)]">{item.value}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-4 p-5 md:p-7 xl:grid-cols-3">
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FaSlidersH className="text-[var(--accent-primary)]" />
                Generation profile
              </div>
              <div className="space-y-2 text-xs text-[var(--muted)]">
                <div className="flex justify-between gap-3"><span>Language</span><span className="text-[var(--foreground)]">{selectedLanguage}</span></div>
                <div className="flex justify-between gap-3"><span>Wiki type</span><span className="text-[var(--foreground)]">{isComprehensiveView ? 'Comprehensive' : 'Concise'}</span></div>
                <div className="flex justify-between gap-3"><span>Provider</span><span className="truncate text-[var(--foreground)]">{provider || 'Default'}</span></div>
                <div className="flex justify-between gap-3"><span>Model</span><span className="truncate text-[var(--foreground)]">{isCustomModel ? customModel : model || 'Default'}</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FaTerminal className="text-[var(--accent-primary)]" />
                Trace pipeline
              </div>
              <div className="space-y-3 text-xs text-[var(--muted)]">
                {['repository scan', 'structure planning', 'page generation', 'cache write'].map((phase, index) => (
                  <div key={phase} className="flex items-center gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] text-[10px]">{index + 1}</span>
                    <span>{phase}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FaCog className="text-[var(--accent-primary)]" />
                File filters
              </div>
              <div className="space-y-2 text-xs text-[var(--muted)]">
                <div className="truncate">Include dirs: <span className="text-[var(--foreground)]">{includedDirs || 'all'}</span></div>
                <div className="truncate">Exclude dirs: <span className="text-[var(--foreground)]">{excludedDirs || 'defaults'}</span></div>
                <div className="truncate">Include files: <span className="text-[var(--foreground)]">{includedFiles || 'all'}</span></div>
                <div className="truncate">Exclude files: <span className="text-[var(--foreground)]">{excludedFiles || 'defaults'}</span></div>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex min-h-[620px] flex-col gap-4">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-custom">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FaHistory className="text-[var(--accent-primary)]" />
                Recent wikis
              </div>
              {projectsLoading && <span className="text-xs text-[var(--muted)]">Loading...</span>}
            </div>
            {!projectsLoading && projects.length > 0 ? (
              <ProcessedProjects showHeader={false} maxItems={5} messages={messages} className="w-full" />
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border-color)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
                No projects yet.
              </div>
            )}
          </div>

          <div className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-custom">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FaTerminal className="text-[var(--accent-primary)]" />
              Trace preview
            </div>
            <div className="space-y-3 text-xs text-[var(--muted)]">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--surface)] p-3">
                Session stream
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--surface)] p-3">
                WebSocket content
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--surface)] p-3">
                Replay buffer
              </div>
            </div>
          </div>
        </aside>
      </main>

      <ConfigurationModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        repositoryInput={repositoryInput}
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={setSelectedLanguage}
        supportedLanguages={supportedLanguages}
        isComprehensiveView={isComprehensiveView}
        setIsComprehensiveView={setIsComprehensiveView}
        provider={provider}
        setProvider={setProvider}
        model={model}
        setModel={setModel}
        isCustomModel={isCustomModel}
        setIsCustomModel={setIsCustomModel}
        customModel={customModel}
        setCustomModel={setCustomModel}
        selectedPlatform={selectedPlatform}
        setSelectedPlatform={setSelectedPlatform}
        accessToken={accessToken}
        setAccessToken={setAccessToken}
        excludedDirs={excludedDirs}
        setExcludedDirs={setExcludedDirs}
        excludedFiles={excludedFiles}
        setExcludedFiles={setExcludedFiles}
        includedDirs={includedDirs}
        setIncludedDirs={setIncludedDirs}
        includedFiles={includedFiles}
        setIncludedFiles={setIncludedFiles}
        onSubmit={handleGenerateWiki}
        isSubmitting={isSubmitting}
        authRequired={authRequired}
        authCode={authCode}
        setAuthCode={setAuthCode}
        isAuthLoading={isAuthLoading}
      />
    </div>
  );
}
