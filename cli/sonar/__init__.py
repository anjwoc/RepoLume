# cli/sonar/__init__.py
"""
RepoLume 정적 분석기 (Sonar)

MIT License 코드 일부를 이식하여 외부 프로세스 실행 없이
AST 기반 아키텍처 다이어그램을 생성합니다.

원본 출처:
  일부 기반 코드: CodeBoarding (MIT License)
  Copyright 2025 CodeBoarding Team
  https://github.com/CodeBoarding/CodeBoarding

적용 범위:
  - call_graph.py  : CallGraph, Node, Edge 데이터 모델
  - ast_analyzer.py: tree-sitter 기반 AST 파싱
  - mermaid_gen.py : Mermaid LR 다이어그램 생성
  - sonar_analyzer.py: 메인 진입점
"""
from cli.sonar.sonar_analyzer import SonarAnalyzer, DiagramCollection

__all__ = ["SonarAnalyzer", "DiagramCollection"]
