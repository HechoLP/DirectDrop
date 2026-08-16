# Security Policy

## 설계 보장

- DirectDrop 서버와 Cloudflare Tunnel은 메타데이터 및 signaling JSON만 처리합니다. 파일 바이트를 저장하거나 프록시하지 않습니다.
- 서버에는 표시 이름, 크기, MIME, 만료·횟수 상태만 저장합니다. 로컬 절대 경로는 송신자 기기의 SQLite 레지스트리에만 존재합니다.
- 공유 토큰과 control key는 CSPRNG URL-safe 값입니다. control key는 SHA-256 해시로만 서버에 저장합니다.
- 공유 비밀번호는 Argon2id로 해시하며 평문을 저장하지 않습니다.
- API, 비밀번호 검증, WebSocket 연결, 다운로드 요청에 속도 제한을 적용합니다.
- 실제 완료 카운트는 수신자가 디스크 스트림을 닫은 뒤 확정한 `COMPLETED` 상태에서만 증가합니다.
- 로컬 파일은 read-only handle로 청크 단위 읽으며, 크기와 수정 시간이 등록 시점과 다르면 전송을 중단합니다.

## 비밀 관리

Cloudflare Tunnel credential JSON, API token, TURN credential, 인증서, 서명 키는 저장소에 커밋하지 않습니다. 운영 값은 로컬 환경 또는 GitHub Actions Secrets에만 둡니다.

## 취약점 신고

공개 이슈에 exploit 또는 개인정보를 올리지 마세요. GitHub 저장소의 Security 탭에서 private vulnerability report를 보내 주세요. 접수 후 영향 범위와 대응 일정을 회신합니다.

지원 범위는 최신 `0.x` 릴리스입니다.
