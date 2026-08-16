# Contributing to DirectDrop

## 개발 절차

1. 이슈에서 변경 범위와 보안 영향을 확인합니다.
2. 작은 브랜치에서 Conventional Commit 형식으로 작업합니다.
3. `pnpm check`와 Rust fmt/clippy/test를 모두 통과시킵니다.
4. 파일 데이터가 서버로 전송되거나 로컬 경로가 외부에 노출되지 않는지 확인합니다.
5. UI 변경은 키보드, 320px 모바일, 600px 데스크톱 창에서 검증합니다.

커밋 예: `feat: add WebRTC transfer`, `fix: release download slot on disconnect`, `docs: update browser support`.

## 절대 보안 경계

사용자 원본 파일을 복사·이동·수정·삭제하거나 서버, R2, S3, GitHub에 저장하는 변경은 받지 않습니다. `.env`, Tunnel credentials, TURN 비밀번호, 인증서, 서명 키도 커밋하지 마세요.
