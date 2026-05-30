# LocalWiki

**LocalWiki**는 어떤 저장소든 쉽게 코드를 분석하고 포괄적인 문서와 시각적 다이어그램을 생성하여 대화형 위키로 만들어주는 강력한 범용 도구입니다.

## ✨ 주요 기능
- **자동 문서화**: 코드 구조 및 관계 파악을 통한 위키 생성
- **다이어그램 생성**: 아키텍처 및 데이터 흐름 시각화 (Mermaid)
- **RAG 기반 Q&A**: 저장소 관련 질의응답 (Ask 기능)
- **DeepResearch**: 다중 턴을 통한 코드베이스 심층 연구

## 🚀 빠른 시작

### 1단계: 환경 변수 설정
프로젝트 루트에 `.env` 파일을 만들고 모델 API 키를 추가합니다.
```
GOOGLE_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key
```

### 2단계: 백엔드 실행
```bash
python -m pip install poetry==2.0.1 && poetry install -C api
python -m api.main
```

### 3단계: 프론트엔드 실행
```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`에 접속하여 사용합니다.

## 🛠️ 프로젝트 구조
- `api/`: 백엔드 API 서버 (FastAPI, RAG, 데이터 파이프라인)
- `src/`: 프론트엔드 Next.js 앱 (UI, 위키 렌더링)
- `public/`: 정적 자산
