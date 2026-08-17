mod identity;
mod manager;
mod protocol;
mod storage;

use serde::Serialize;
use thiserror::Error;

pub use manager::{NearbyManager, NearbyStatus, NearbyTransferSnapshot, PairingTicket};
pub use protocol::LanFile;
pub use storage::{sanitize_filename, LocalSource};

#[derive(Debug, Error)]
pub enum NearbyError {
    #[error("Nearby 상태를 사용할 수 없습니다.")]
    StateUnavailable,
    #[error("요청한 Nearby 항목을 찾을 수 없습니다.")]
    NotFound,
    #[error("기기 페어링이 필요합니다.")]
    PairingRequired,
    #[error("기기 인증에 실패했습니다.")]
    Authentication,
    #[error("상대방이 요청을 거절했습니다.")]
    Rejected,
    #[error("요청 시간이 초과되었습니다.")]
    Timeout,
    #[error("전송이 취소되었습니다.")]
    Cancelled,
    #[error("Nearby가 다른 요청을 처리 중입니다.")]
    Busy,
    #[error("호환되지 않는 DirectDrop LAN protocol입니다.")]
    ProtocolVersion,
    #[error("안전하지 않은 상대 경로를 거부했습니다.")]
    UnsafePath,
    #[error("전송 데이터 무결성 검증에 실패했습니다.")]
    Integrity,
    #[error("원본 파일이 변경되었습니다: {0}")]
    SourceChanged(String),
    #[error("잘못된 요청입니다: {0}")]
    InvalidInput(String),
    #[error("Nearby protocol 오류: {0}")]
    Protocol(String),
    #[error("암호화 설정 오류: {0}")]
    Crypto(String),
    #[error("I/O 오류: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 오류: {0}")]
    Json(#[from] serde_json::Error),
    #[error("인증서 생성 오류: {0}")]
    Certificate(#[from] rcgen::Error),
    #[error("TLS 오류: {0}")]
    Tls(#[from] rustls::Error),
    #[error("mDNS 오류: {0}")]
    Mdns(#[from] mdns_sd::Error),
    #[error("요청 시간이 초과되었습니다.")]
    TokioTimeout(#[from] tokio::time::error::Elapsed),
}

impl Serialize for NearbyError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
