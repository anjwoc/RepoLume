DeepWiki 애플리케이션의 핵심 UI 진입점과 전체적인 레이아웃 구조는 Next.js App Router 방식을 따르며, 화면 상태의 전환과 스타일링이 어떻게 관리되는지 정의합니다.

# Overview

DeepWiki의 프론트엔드는 `src/app/layout.tsx`에서 정의하는 전역 HTML 구조와 `src/app/globals.css`의 디자인 테마를 바탕으로 렌더링됩니다. 메인 비즈니스 로직 및 화면 전환은 `src/app/page.tsx`에서 클라이언트 상태(Client State)를 기반으로 이루어지며, 사용자 설정은 `localStorage`를 통해 영구적으로 보존(Persist)됩니다.

# 루트 레이아웃 (`src/app/layout.tsx`)

`RootLayout`은 애플리케이션의 최상단에 위치하는 컴포넌트로, 모든 페이지에 공통으로 적용되는 HTML 기본 뼈대와 메타데이터를 설정합니다.

* **Metadata**: 웹 브라우저 탭과 검색 엔진에 노출되는 사이트의 제목(Title), 설명(Description), 파비콘(Icons)을 관리합니다.
* **Fonts**: `next/font/google`을 사용해 `Geist` 및 `Geist_Mono` 폰트를 최적화하여 불러오고, 이를 CSS 변수(`--font-sans`, `--font-mono`)로 매핑해 애플리케이션 전반에서 사용할 수 있게 만듭니다.
* **Global CSS**: `globals.css`를 불러와서 Tailwind CSS 프레임워크와 애플리케이션 전반의 공통 스타일을 적용합니다.
* **Analytics**: 프로덕션 환경(`process.env.NODE_ENV === 'production'`) 배포 시 트래픽을 측정하기 위해 Vercel의 `<Analytics />` 컴포넌트를 활성화합니다.

# 전역 스타일링 (`src/app/globals.css`)

애플리케이션 전반에 걸쳐 사용되는 디자인 시스템과 테마 관련 설정이 포함되어 있습니다.

* **Tailwind CSS**: ` @import 'tailwindcss'` 구문으로 Tailwind 프레임워크를 프로젝트에 초기화합니다.
* **Color Scheme**: `oklch` 색상 체계를 사용하여 `:root`에는 라이트 모드용, `.dark`에는 다크 모드용 CSS 색상 변수를 정의합니다.
* **Theme Mapping**: ` @theme inline` 블록을 활용하여 사용자가 정의한 CSS 속성들을 Tailwind 테마에서 사용할 수 있도록 연동합니다. (예: `--color-background: var(--background)`)
* **Base Layer**: ` @layer base`를 사용하여 애플리케이션의 `body` 요소에 기본 배경색(`bg-background`)과 텍스트 색상(`text-foreground`)을 강제 적용합니다.

# 메인 페이지 (`src/app/page.tsx`)

메인 페이지인 `Page` 컴포넌트는 `"use client"` 지시어를 사용하여 클라이언트 컴포넌트로 선언되며, SPA(Single Page Application) 환경에서 화면 이동을 처리하는 핵심 라우팅 로직을 담당합니다.

* **State Management**: React의 `useState` 훅을 사용해 현재 보여줄 화면을 `screen`이라는 상태값으로 관리합니다. 상태값은 다음과 같이 6가지 중 하나를 가집니다:
  * `"setup"`, `"home"`, `"analyzing"`, `"wiki"`, `"settings"`, `"admin"`
* **Local Storage Integration**: `useEffect` 훅이 처음 실행될 때 `loadAppSettings()` 함수를 호출합니다. 이 함수는 브라우저의 `localStorage` 안에 있는 `deepwiki_app_settings` 정보를 읽어오며, 초기 설정 완료 여부(`setupComplete`)에 따라 사용자를 `"setup"` 화면으로 보낼지 `"home"` 대시보드로 보낼지 결정합니다.
* **Component Rendering**: Framer Motion의 `AnimatePresence` 컴포넌트를 사용하여 화면이 바뀔 때 부드러운 애니메이션을 적용합니다. 현재의 `screen` 상태값에 알맞은 다음 컴포넌트를 화면에 렌더링합니다:
  * `<SetupWizard />` : 애플리케이션 최초 실행 시 설정 화면
  * `<HomeScreen />` : 프로젝트를 선택할 수 있는 기본 메인 대시보드
  * `<StreamLogViewer />` : 분석 진행 과정과 로그를 실시간으로 보여주는 화면
  * `<WikiViewer />` : 분석이 완료되어 생성된 위키 문서를 열람하는 화면
  * `<SettingsScreen />` : 애플리케이션 설정을 변경하는 화면
  * `<AdminLogsScreen />` : 시스템 로그 및 오류 기록을 조회하는 화면

# 아키텍처 흐름도

루트 레이아웃에서부터 메인 페이지의 화면 상태(Screen State)가 어떻게 상호작용하고 전환되는지 보여주는 흐름도입니다.

```mermaid
graph LR
  subgraph Layout ["루트 레이아웃 (layout.tsx)"]
    HTML["html lang='ko'"]
    Body["body<br>(Fonts & globals.css)"]
    Analytics["Analytics<br>Component"]
    
    HTML --> Body
    Body --> Analytics
  end

  subgraph Styling ["전역 스타일 (globals.css)"]
    Theme["라이트/다크 모드<br>oklch Variables"]
    Tailwind["Tailwind CSS<br>Integration"]
  end

  subgraph Page ["메인 페이지 (page.tsx)"]
    Init["loadAppSettings()<br>from localStorage"]
    State["Screen State"]
    
    Init -->|setupComplete=false| Setup["SetupWizard"]
    Init -->|setupComplete=true| Home["HomeScreen"]
    
    Home -->|프로젝트 선택| Analyzing["StreamLogViewer"]
    Home -->|설정 메뉴 클릭| Settings["SettingsScreen"]
    Home -->|어드민 메뉴 클릭| Admin["AdminLogsScreen"]
    Home -->|위키 열기| Wiki["WikiViewer"]
    
    Analyzing -->|분석 완료| Wiki
    Analyzing -->|분석 취소| Home
    
    Setup -->|설정 완료| Home
    Settings -->|뒤로가기| Home
    Admin -->|뒤로가기| Home
    Wiki -->|홈으로 이동| Home
  end

  Body --> Init
  Theme -.-> Body
  Tailwind -.-> Body
