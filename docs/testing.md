# Testing DirectDrop

## 자동 검증

```bash
pnpm check
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm audit --prod --audit-level high
cargo audit --file apps/desktop/src-tauri/Cargo.lock
```

테스트는 CSPRNG 토큰과 충돌 표본, 만료, 동시 slot 예약, rollback, 이중 완료 확인과 중복 방지, 경로 비노출, hostile filename, 비밀번호, cleanup off, WebSocket origin·register·join·presence·offer·권한, 예약/전송 watchdog, malformed protocol, protocol version, chunk 순서·offset·SHA-256, 브라우저 비덮어쓰기 저장, 로컬 레지스트리 삭제 시 원본 보존, 4 GiB 초과 offset 읽기를 다룹니다.

## 실제 흐름

1. 서버와 Tunnel을 실행하고 `/health`가 `fileStorage: false`인지 확인합니다.
2. Tauri 앱에서 작은 파일을 등록해 Share를 만듭니다.
3. 별도 Chrome/Edge 프로필 또는 다른 기기로 링크를 열어 저장 위치를 선택합니다.
4. offer/answer/ICE, DataChannel open, 양쪽 진행률, 저장 완료 후 count 증가를 확인합니다.
5. 네트워크를 끊은 실패 세션이 count를 올리지 않고 slot을 반환하는지 확인합니다.

자동화된 protocol 또는 상태 테스트는 실제 두 장치의 파일 전송을 대체하지 않습니다. 실행하지 않은 브라우저·OS·파일 크기는 감사 보고서에서 `NOT TESTED`로 기록합니다.

## 대용량

1 GiB, 10 GiB, 100 GiB sparse fixture는 `truncate -s 1G`, `truncate -s 10G`, `truncate -s 100G`로 만들 수 있습니다. 실제 전송은 두 장치와 충분한 디스크 공간에서 순서대로 수행하고, 앱·브라우저 RSS가 파일 크기에 비례하지 않는지 확인합니다. 저장 결과의 크기와 SHA-256을 원본과 비교합니다. 100 GiB 검증은 CI에서 실행하지 않습니다.

## 반응형·상태 화면

랜딩과 수신 화면을 320, 360, 375, 390, 430, 768, 1024, 1440, 1920px에서 확인합니다. Tauri UI는 600, 900, 1200px에서 파일 없음/선택/공유/전송/완료/오류를 확인합니다. 수신 화면은 online/offline/password/expired/limit/error 상태와 sticky CTA, safe area, 긴 파일명을 확인합니다.

## 최종 감사

2026-08-17에 실행한 명령, 실제 범위, 미실행 조합과 Release Gate는 [final-audit.md](final-audit.md)에 기록합니다. 위 목록은 테스트 절차이며 그 자체가 실행 결과를 뜻하지 않습니다.
