import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Database,
  Download,
  FileCode2,
  FileText,
  FolderGit2,
  GitPullRequest,
  LockKeyhole,
  Network,
  ScanSearch,
  ServerCog,
  Sparkles,
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { RepoLumeMark } from "@/components/repolume-mark";
import { WikiThemeComparison } from "./wiki-theme-comparison";
import styles from "./landing-page.module.css";

const RELEASE_URL = "https://github.com/anjwoc/RepoLume/releases/latest";
const GITHUB_URL = "https://github.com/anjwoc/RepoLume";

const steps = [
  {
    number: "01",
    title: "저장소 선택",
    description: "내 컴퓨터의 프로젝트 폴더를 선택합니다. 원본 코드는 외부 저장소로 업로드하지 않습니다.",
    icon: FolderGit2,
  },
  {
    number: "02",
    title: "구조와 목차 검토",
    description: "파일 구조와 코드 관계를 읽어 위키 목차를 제안합니다. 생성 전에 범위를 직접 확인할 수 있습니다.",
    icon: ScanSearch,
  },
  {
    number: "03",
    title: "위키 생성",
    description: "선택한 목차를 기준으로 문서와 Mermaid 다이어그램을 만들고, 진행 상태를 단계별로 보여줍니다.",
    icon: FileText,
  },
];

const principles = [
  {
    title: "Local-first",
    description: "분석할 폴더를 직접 고르고, 코드와 생성 결과를 내 컴퓨터에서 관리합니다.",
    icon: LockKeyhole,
  },
  {
    title: "Review before write",
    description: "AI가 제안한 목차를 먼저 검토한 뒤 문서 생성을 시작합니다.",
    icon: GitPullRequest,
  },
  {
    title: "Docs that stay useful",
    description: "Markdown 문서와 Mermaid 다이어그램으로 구조와 흐름을 함께 남깁니다.",
    icon: Network,
  },
];

export function LandingPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        본문으로 건너뛰기
      </a>

      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="RepoLume 홈">
          <RepoLumeMark size={38} />
          <span>Repo<span>Lume</span></span>
        </a>
        <nav className={styles.nav} aria-label="주요 메뉴">
          <a href="#workflow">작동 방식</a>
          <a href="#mcp">MCP 교차 검증</a>
          <a href="#output">생성 결과</a>
        </nav>
        <a className={styles.headerCta} href={RELEASE_URL} target="_blank" rel="noreferrer">
          다운로드 <ArrowRight size={15} aria-hidden="true" />
        </a>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.ambientOne} aria-hidden="true" />
        <div className={styles.ambientTwo} aria-hidden="true" />
        <div className={styles.heroContent} id="main-content">
          <p className={styles.eyebrow}>
            <span><Sparkles size={14} aria-hidden="true" /></span>
            Local-first codebase wiki
          </p>
          <h1>
            코드베이스를,
            <span>읽을 수 있는 위키로.</span>
          </h1>
          <p className={styles.heroCopy}>
            RepoLume는 로컬 저장소의 구조와 흐름을 분석해, 팀이 탐색하고 검토할 수 있는 문서와 다이어그램으로 정리합니다.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryCta} href={RELEASE_URL} target="_blank" rel="noreferrer">
              <Download size={18} aria-hidden="true" />
              macOS용 다운로드
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className={styles.secondaryCta} href={GITHUB_URL} target="_blank" rel="noreferrer">
              <FaGithub size={18} aria-hidden="true" />
              GitHub에서 보기
            </a>
          </div>
          <ul className={styles.proofList} aria-label="주요 특징">
            <li><Check size={14} aria-hidden="true" /> 코드 업로드 없음</li>
            <li><Check size={14} aria-hidden="true" /> 목차 검토 후 생성</li>
            <li><Check size={14} aria-hidden="true" /> Markdown + Mermaid</li>
          </ul>
        </div>

        <div className={styles.productStage} aria-label="RepoLume에서 실제 생성된 위키 화면">
          <div className={styles.orbit} aria-hidden="true" />
          <div className={styles.layerMark} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <WikiThemeComparison />
        </div>
      </section>

      <section className={styles.mcpSection} id="mcp">
        <div className={styles.mcpCopy}>
          <p className={styles.sectionLabel}>OPTIONAL MCP CROSS-CHECK</p>
          <h2>코드 밖의 맥락도<br />근거와 함께 확인합니다.</h2>
          <p>
            MCP 소스가 연결되어 있으면 코드 분석 결과를 DB 스키마와 프로젝트 맥락에 대조하고,
            사용된 출처를 생성 문서에 함께 남깁니다.
          </p>
          <div className={styles.fallbackNote}>
            <LockKeyhole size={17} aria-hidden="true" />
            <span><strong>MCP 연결은 선택 사항입니다.</strong> 연결하지 않으면 코드베이스 근거만 사용해 위키를 생성합니다.</span>
          </div>
        </div>
        <div className={styles.mcpFlow} aria-label="MCP 교차 검증 흐름">
          <div className={styles.mcpSources}>
            <div><FileCode2 size={18} /><span><strong>Codebase</strong><small>AST · call graph</small></span></div>
            <div><Database size={18} /><span><strong>Database MCP</strong><small>schema · procedure</small></span></div>
            <div><ServerCog size={18} /><span><strong>Project MCP</strong><small>연결된 외부 맥락</small></span></div>
          </div>
          <div className={styles.flowConnector}><span /><em>교차 검증</em><span /></div>
          <div className={styles.citedWiki}>
            <BookOpenCheck size={24} aria-hidden="true" />
            <span><strong>출처가 남는 위키</strong><small>사용한 근거와 수집 시점을 문서에 기록</small></span>
          </div>
        </div>
      </section>

      <section className={styles.workflow} id="workflow">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionLabel}>FROM REPOSITORY TO WIKI</p>
          <h2>세 단계면 충분합니다.</h2>
          <p>분석 범위를 선택하고, 제안된 구성을 검토하고, 필요한 위키를 생성하세요.</p>
        </div>
        <div className={styles.stepGrid}>
          {steps.map(({ number, title, description, icon: Icon }) => (
            <article className={styles.stepCard} key={number}>
              <div className={styles.stepTop}>
                <span className={styles.stepIcon}><Icon size={20} aria-hidden="true" /></span>
                <span className={styles.stepNumber}>{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.output} id="output">
        <div className={styles.outputCopy}>
          <p className={styles.sectionLabel}>A WIKI YOU CAN REVIEW</p>
          <h2>코드만 보던 화면에<br />맥락이 생깁니다.</h2>
          <p>
            파일 목록을 나열하는 데서 끝나지 않습니다. 시작 방법, 시스템 구조, 데이터 흐름을 서로 연결된 위키 페이지로 정리합니다.
          </p>
          <ul>
            <li><Check size={16} /> 섹션별 탐색이 가능한 목차</li>
            <li><Check size={16} /> 코드 흐름을 설명하는 Mermaid 다이어그램</li>
            <li><Check size={16} /> 생성 단계와 로그를 확인하는 진행 화면</li>
          </ul>
        </div>
        <div className={styles.outputGrid}>
          <article className={`${styles.outputCard} ${styles.documentCard}`}>
            <div className={styles.cardLabel}><FileText size={15} /> STRUCTURED DOCS</div>
            <h3>한눈에 보는 문서 구조</h3>
            <div className={styles.docTree}>
              <div><span>01</span><strong>Getting started</strong><small>4 pages</small></div>
              <div><span>02</span><strong>System overview</strong><small>6 pages</small></div>
              <div><span>03</span><strong>Business flows</strong><small>5 pages</small></div>
            </div>
          </article>
          <article className={`${styles.outputCard} ${styles.codeCard}`}>
            <div className={styles.cardLabel}><FileCode2 size={15} /> SOURCE GROUNDED</div>
            <h3>원본 파일과 함께 보는 설명</h3>
            <div className={styles.codeSnippet}>
              <span><i>12</i><b>export</b> async function createOrder()</span>
              <span><i>13</i>&nbsp;&nbsp;await inventory.reserve()</span>
              <span><i>14</i>&nbsp;&nbsp;return order.save()</span>
            </div>
          </article>
          <article className={`${styles.outputCard} ${styles.reviewCard}`}>
            <div className={styles.cardLabel}><GitPullRequest size={15} /> REVIEW GATE</div>
            <h3>쓰기 전에 먼저 확인</h3>
            <div className={styles.reviewBox}>
              <div><span><Check size={13} /></span><p><strong>목차 제안 완료</strong><small>8 sections · 24 pages</small></p></div>
              <button type="button" tabIndex={-1}>이 구성으로 생성</button>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.localFirst} id="local-first">
        <div className={styles.sectionIntro}>
          <p className={styles.sectionLabel}>DESIGNED FOR YOUR CODEBASE</p>
          <h2>코드는 가까이, 문서는 명확하게.</h2>
          <p>분석 과정의 제어권과 결과물의 소유권을 사용자에게 돌려주는 원칙으로 설계했습니다.</p>
        </div>
        <div className={styles.principleGrid}>
          {principles.map(({ title, description, icon: Icon }) => (
            <article key={title}>
              <span><Icon size={21} aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.ctaGlow} aria-hidden="true" />
        <RepoLumeMark size={64} />
        <p className={styles.sectionLabel}>YOUR CODEBASE, ILLUMINATED.</p>
        <h2>다음 프로젝트를<br />읽을 수 있게 만드세요.</h2>
        <p>RepoLume 데스크톱 앱에서 로컬 저장소를 선택하고 첫 위키를 생성해 보세요.</p>
        <div className={styles.heroActions}>
          <a className={styles.primaryCta} href={RELEASE_URL} target="_blank" rel="noreferrer">
            <Download size={18} aria-hidden="true" />
            RepoLume 다운로드
            <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a className={styles.secondaryCta} href={GITHUB_URL} target="_blank" rel="noreferrer">
            <FaGithub size={18} aria-hidden="true" /> 오픈소스 보기
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <a className={styles.brand} href="#top" aria-label="RepoLume 홈으로 이동">
          <RepoLumeMark size={30} />
          <span>Repo<span>Lume</span></span>
        </a>
        <p>Local-first codebase wiki generator.</p>
        <div>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>
        </div>
      </footer>
    </main>
  );
}
