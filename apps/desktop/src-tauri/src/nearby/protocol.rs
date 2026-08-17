use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::NearbyError;

pub const LAN_PROTOCOL_VERSION: u16 = 1;
pub const CERTIFICATE_REQUEST_MAGIC: &[u8; 8] = b"DDCERT1\n";
pub const MAX_CONTROL_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_CHUNK_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_TRANSFER_FILES: usize = 10_000;
pub const MAX_RELATIVE_PATH_BYTES: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanFile {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub size: u64,
    pub mime_type: String,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOffset {
    pub file_id: String,
    pub offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WireMessage {
    Challenge {
        protocol_version: u16,
        server_nonce: String,
        server_device_id: String,
        server_device_name: String,
        certificate_fingerprint: String,
    },
    Authenticate {
        protocol_version: u16,
        device_id: String,
        device_name: String,
        certificate_fingerprint: String,
        expected_server_fingerprint: String,
        client_nonce: String,
        proof: Option<String>,
    },
    Authenticated {
        proof: String,
    },
    PairingRequired {
        pairing_id: String,
        code: String,
    },
    PairingDecision {
        pairing_id: String,
        accepted: bool,
    },
    PairingSecret {
        pairing_id: String,
        shared_secret: String,
    },
    PairingComplete {
        pairing_id: String,
    },
    TransferOffer {
        transfer_id: String,
        files: Vec<LanFile>,
        total_bytes: u64,
    },
    TransferDecision {
        transfer_id: String,
        accepted: bool,
        offsets: Vec<FileOffset>,
    },
    Chunk {
        transfer_id: String,
        file_id: String,
        offset: u64,
        length: u32,
        sha256: String,
    },
    Ack {
        transfer_id: String,
        file_id: String,
        received_offset: u64,
    },
    Complete {
        transfer_id: String,
    },
    CompleteAck {
        transfer_id: String,
    },
    Cancel {
        transfer_id: String,
    },
    Error {
        code: String,
        message: String,
    },
}

pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    message: &WireMessage,
) -> Result<(), NearbyError> {
    let payload = serde_json::to_vec(message)?;
    if payload.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(NearbyError::Protocol("control frame too large".to_owned()));
    }
    writer.write_u32(payload.len() as u32).await?;
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

pub async fn read_message<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<WireMessage, NearbyError> {
    read_json_frame(reader).await
}

async fn read_json_frame<R: AsyncRead + Unpin, T: DeserializeOwned>(
    reader: &mut R,
) -> Result<T, NearbyError> {
    let length = reader.read_u32().await? as usize;
    if length == 0 || length > MAX_CONTROL_FRAME_BYTES {
        return Err(NearbyError::Protocol(
            "invalid control frame length".to_owned(),
        ));
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    Ok(serde_json::from_slice(&payload)?)
}

pub async fn write_chunk<W: AsyncWrite + Unpin>(
    writer: &mut W,
    header: WireMessage,
    bytes: &[u8],
) -> Result<(), NearbyError> {
    if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES {
        return Err(NearbyError::Protocol("invalid chunk length".to_owned()));
    }
    match &header {
        WireMessage::Chunk { length, .. } if *length as usize == bytes.len() => {}
        _ => return Err(NearbyError::Protocol("chunk header mismatch".to_owned())),
    }
    write_message(writer, &header).await?;
    writer.write_all(bytes).await?;
    writer.flush().await?;
    Ok(())
}

pub async fn read_chunk<R: AsyncRead + Unpin>(
    reader: &mut R,
    length: usize,
) -> Result<Vec<u8>, NearbyError> {
    if length == 0 || length > MAX_CHUNK_BYTES {
        return Err(NearbyError::Protocol("invalid chunk length".to_owned()));
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes).await?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frame_round_trip_and_size_limit() {
        let message = WireMessage::Cancel {
            transfer_id: "transfer-12345678".to_owned(),
        };
        let mut buffer = Vec::new();
        write_message(&mut buffer, &message).await.unwrap();
        let parsed = read_message(&mut buffer.as_slice()).await.unwrap();
        assert!(matches!(
            parsed,
            WireMessage::Cancel { transfer_id } if transfer_id == "transfer-12345678"
        ));

        let oversized = (MAX_CONTROL_FRAME_BYTES as u32 + 1).to_be_bytes();
        assert!(read_message(&mut oversized.as_slice()).await.is_err());
    }
}
