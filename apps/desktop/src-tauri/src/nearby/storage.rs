use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncSeekExt, AsyncWriteExt, SeekFrom},
};

use super::{
    protocol::{FileOffset, LanFile, MAX_RELATIVE_PATH_BYTES, MAX_TRANSFER_FILES},
    NearbyError,
};

#[derive(Debug, Clone)]
pub struct LocalSource {
    pub file: LanFile,
    pub path: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResumeState {
    manifest_hash: String,
    #[serde(default)]
    offsets: HashMap<String, u64>,
}

struct ReceiveFile {
    metadata: LanFile,
    handle: File,
    offset: u64,
}

pub struct ReceiveSession {
    transfer_id: String,
    download_directory: PathBuf,
    staging_directory: PathBuf,
    files_directory: PathBuf,
    state_path: PathBuf,
    manifest_hash: String,
    verified_offsets: HashMap<String, u64>,
    files: HashMap<String, ReceiveFile>,
    file_order: Vec<String>,
}

impl ReceiveSession {
    pub async fn prepare(
        download_directory: PathBuf,
        transfer_id: &str,
        manifest: &[LanFile],
    ) -> Result<(Self, Vec<FileOffset>), NearbyError> {
        validate_transfer_id(transfer_id)?;
        validate_manifest(manifest)?;
        fs::create_dir_all(&download_directory).await?;
        let staging_directory = download_directory
            .join(".directdrop-partial")
            .join(transfer_id);
        let files_directory = staging_directory.join("files");
        fs::create_dir_all(&files_directory).await?;

        let manifest_hash = manifest_hash(manifest)?;
        let state_path = staging_directory.join("state.json");
        let mut resume_state = if state_path.exists() {
            let encoded = fs::read(&state_path).await?;
            if encoded.len() > 1024 * 1024 {
                return Err(NearbyError::Protocol(
                    "resume state is too large".to_owned(),
                ));
            }
            let existing: ResumeState = serde_json::from_slice(&encoded)?;
            if existing.manifest_hash != manifest_hash {
                return Err(NearbyError::Protocol(
                    "resume manifest does not match".to_owned(),
                ));
            }
            existing
        } else {
            ResumeState {
                manifest_hash: manifest_hash.clone(),
                offsets: HashMap::new(),
            }
        };
        let valid_ids = manifest
            .iter()
            .map(|file| file.id.as_str())
            .collect::<HashSet<_>>();
        if resume_state
            .offsets
            .keys()
            .any(|file_id| !valid_ids.contains(file_id.as_str()))
        {
            return Err(NearbyError::Protocol(
                "resume state contains an unknown file".to_owned(),
            ));
        }

        let mut files = HashMap::with_capacity(manifest.len());
        let mut offsets = Vec::with_capacity(manifest.len());
        let mut file_order = Vec::with_capacity(manifest.len());
        for metadata in manifest {
            let relative = validate_relative_path(&metadata.relative_path)?;
            let path = files_directory.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).await?;
            }
            let handle = OpenOptions::new()
                .create(true)
                .read(true)
                .write(true)
                .truncate(false)
                .open(&path)
                .await?;
            let actual_size = handle.metadata().await?.len();
            let offset = *resume_state.offsets.get(&metadata.id).unwrap_or(&0);
            if offset > metadata.size {
                return Err(NearbyError::Protocol(
                    "partial file exceeds declared size".to_owned(),
                ));
            }
            if actual_size < offset {
                return Err(NearbyError::Protocol(
                    "partial file is shorter than its verified offset".to_owned(),
                ));
            }
            if actual_size > offset {
                handle.set_len(offset).await?;
            }
            resume_state.offsets.insert(metadata.id.clone(), offset);
            offsets.push(FileOffset {
                file_id: metadata.id.clone(),
                offset,
            });
            file_order.push(metadata.id.clone());
            files.insert(
                metadata.id.clone(),
                ReceiveFile {
                    metadata: metadata.clone(),
                    handle,
                    offset,
                },
            );
        }
        persist_resume_state(&state_path, &resume_state).await?;
        Ok((
            Self {
                transfer_id: transfer_id.to_owned(),
                download_directory,
                staging_directory,
                files_directory,
                state_path,
                manifest_hash,
                verified_offsets: resume_state.offsets,
                files,
                file_order,
            },
            offsets,
        ))
    }

    pub async fn write_chunk(
        &mut self,
        file_id: &str,
        offset: u64,
        expected_sha256: &str,
        bytes: &[u8],
    ) -> Result<u64, NearbyError> {
        if expected_sha256.len() != 64
            || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(NearbyError::Protocol("invalid chunk digest".to_owned()));
        }
        let actual = sha256_hex(bytes);
        if actual != expected_sha256.to_ascii_lowercase() {
            return Err(NearbyError::Integrity);
        }
        let received_offset = {
            let file = self
                .files
                .get_mut(file_id)
                .ok_or_else(|| NearbyError::Protocol("unknown file id".to_owned()))?;
            if file.offset != offset
                || bytes.is_empty()
                || offset
                    .checked_add(bytes.len() as u64)
                    .is_none_or(|end| end > file.metadata.size)
            {
                return Err(NearbyError::Protocol("invalid chunk offset".to_owned()));
            }
            file.handle.seek(SeekFrom::Start(offset)).await?;
            file.handle.write_all(bytes).await?;
            file.handle.sync_data().await?;
            file.offset += bytes.len() as u64;
            file.offset
        };
        self.verified_offsets
            .insert(file_id.to_owned(), received_offset);
        self.persist_state().await?;
        Ok(received_offset)
    }

    pub fn transferred_bytes(&self) -> u64 {
        self.files.values().map(|file| file.offset).sum()
    }

    async fn persist_state(&self) -> Result<(), NearbyError> {
        persist_resume_state(
            &self.state_path,
            &ResumeState {
                manifest_hash: self.manifest_hash.clone(),
                offsets: self.verified_offsets.clone(),
            },
        )
        .await
    }

    pub async fn complete(mut self) -> Result<Vec<PathBuf>, NearbyError> {
        let relative_paths = self
            .file_order
            .iter()
            .filter_map(|file_id| self.files.get(file_id))
            .map(|file| file.metadata.relative_path.clone())
            .collect::<Vec<_>>();
        for file_id in &self.file_order {
            let file = self
                .files
                .get_mut(file_id)
                .ok_or_else(|| NearbyError::Protocol("completion file missing".to_owned()))?;
            if file.offset != file.metadata.size {
                return Err(NearbyError::Protocol(
                    "transfer completed before all bytes arrived".to_owned(),
                ));
            }
            file.handle.sync_all().await?;
        }
        drop(self.files);

        let mut destinations = Vec::new();
        if self.file_order.len() == 1 && !relative_paths[0].contains('/') {
            let source = first_file_path(&self.files_directory).await?;
            let name = source
                .file_name()
                .ok_or_else(|| NearbyError::Protocol("missing final filename".to_owned()))?;
            let destination = unique_path(&self.download_directory, name).await?;
            fs::rename(&source, &destination).await?;
            destinations.push(destination);
        } else if let Some(top_level) = shared_top_level_directory(&relative_paths) {
            let source = self.files_directory.join(&top_level);
            let destination =
                unique_path(&self.download_directory, std::ffi::OsStr::new(&top_level)).await?;
            fs::rename(&source, &destination).await?;
            destinations.push(destination);
        } else {
            let directory_name = format!("DirectDrop Transfer {}", &self.transfer_id[..8]);
            let destination = unique_path(
                &self.download_directory,
                std::ffi::OsStr::new(&directory_name),
            )
            .await?;
            fs::rename(&self.files_directory, &destination).await?;
            destinations.push(destination);
        }
        if self.staging_directory.exists() {
            fs::remove_dir_all(&self.staging_directory).await?;
        }
        Ok(destinations)
    }

    pub async fn cancel(self) -> Result<(), NearbyError> {
        drop(self.files);
        if self.staging_directory.exists() {
            fs::remove_dir_all(self.staging_directory).await?;
        }
        Ok(())
    }
}

async fn persist_resume_state(path: &Path, state: &ResumeState) -> Result<(), NearbyError> {
    let payload = serde_json::to_vec(state)?;
    let temporary = path.with_extension("json.tmp");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600)).await?;
    }
    file.write_all(&payload).await?;
    file.sync_all().await?;
    drop(file);
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).await?;
    }
    fs::rename(&temporary, path).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    }
    Ok(())
}

fn shared_top_level_directory(paths: &[String]) -> Option<String> {
    let first = paths.first()?.split_once('/')?.0;
    paths
        .iter()
        .all(|path| path.split_once('/').is_some_and(|(top, _)| top == first))
        .then(|| first.to_owned())
}

pub fn validate_manifest(files: &[LanFile]) -> Result<u64, NearbyError> {
    if files.is_empty() || files.len() > MAX_TRANSFER_FILES {
        return Err(NearbyError::Protocol("invalid file count".to_owned()));
    }
    let mut ids = HashSet::with_capacity(files.len());
    let mut paths = HashSet::with_capacity(files.len());
    let mut total = 0_u64;
    for file in files {
        if file.id.len() < 8 || file.id.len() > 128 || !ids.insert(file.id.clone()) {
            return Err(NearbyError::Protocol(
                "invalid or duplicate file id".to_owned(),
            ));
        }
        if file.name.is_empty() || file.name.len() > 255 || file.mime_type.len() > 255 {
            return Err(NearbyError::Protocol("invalid file metadata".to_owned()));
        }
        let relative = validate_relative_path(&file.relative_path)?;
        if !paths.insert(relative) {
            return Err(NearbyError::Protocol("duplicate relative path".to_owned()));
        }
        total = total
            .checked_add(file.size)
            .ok_or_else(|| NearbyError::Protocol("total size overflow".to_owned()))?;
    }
    Ok(total)
}

pub fn validate_relative_path(value: &str) -> Result<PathBuf, NearbyError> {
    if value.is_empty()
        || value.len() > MAX_RELATIVE_PATH_BYTES
        || value.starts_with(['/', '\\'])
        || value.contains('\\')
        || value.contains(':')
        || value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '\u{202A}'
                        ..='\u{202E}' | '\u{2066}'
                        ..='\u{2069}' | '\u{200E}' | '\u{200F}'
                )
        })
    {
        return Err(NearbyError::UnsafePath);
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(value).components() {
        let Component::Normal(part) = component else {
            return Err(NearbyError::UnsafePath);
        };
        let text = part.to_str().ok_or(NearbyError::UnsafePath)?;
        if text.is_empty()
            || text.len() > 255
            || text.ends_with(['.', ' '])
            || is_windows_reserved(text)
        {
            return Err(NearbyError::UnsafePath);
        }
        normalized.push(part);
    }
    if normalized.as_os_str().is_empty() {
        return Err(NearbyError::UnsafePath);
    }
    Ok(normalized)
}

pub fn sanitize_filename(value: &str) -> String {
    let mut sanitized = value
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\u{202A}'
                        ..='\u{202E}' | '\u{2066}'
                        ..='\u{2069}' | '\u{200E}' | '\u{200F}'
                )
        })
        .take(240)
        .collect::<String>()
        .trim()
        .trim_end_matches(['.', ' '])
        .to_owned();
    if sanitized.is_empty() {
        sanitized = "unnamed".to_owned();
    }
    if is_windows_reserved(&sanitized) {
        sanitized.insert(0, '_');
    }
    sanitized
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_windows_reserved(value: &str) -> bool {
    let stem = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

fn validate_transfer_id(value: &str) -> Result<(), NearbyError> {
    if value.len() < 8
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(NearbyError::UnsafePath);
    }
    Ok(())
}

fn manifest_hash(files: &[LanFile]) -> Result<String, NearbyError> {
    Ok(sha256_hex(&serde_json::to_vec(files)?))
}

async fn unique_path(parent: &Path, name: &std::ffi::OsStr) -> Result<PathBuf, NearbyError> {
    let candidate = parent.join(name);
    if !candidate.exists() {
        return Ok(candidate);
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("DirectDrop");
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 1..=10_000 {
        let filename = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(filename);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(NearbyError::Io(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "no available destination filename",
    )))
}

async fn first_file_path(root: &Path) -> Result<PathBuf, NearbyError> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory).await?;
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_dir() {
                pending.push(entry.path());
            } else {
                return Ok(entry.path());
            }
        }
    }
    Err(NearbyError::Protocol("received file missing".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(relative_path: &str, size: u64) -> LanFile {
        LanFile {
            id: format!("file-{relative_path}-12345678"),
            name: relative_path.rsplit('/').next().unwrap().to_owned(),
            relative_path: relative_path.to_owned(),
            size,
            mime_type: "application/octet-stream".to_owned(),
            modified_at: 0,
        }
    }

    #[test]
    fn rejects_traversal_and_cross_platform_reserved_paths() {
        for path in [
            "../secret",
            "/etc/passwd",
            "C:/Windows/file",
            "folder\\secret",
            "folder/CON",
            "folder/file. ",
            "safe/\u{202e}txt.exe",
        ] {
            assert!(validate_relative_path(path).is_err(), "accepted {path}");
        }
        assert_eq!(
            validate_relative_path("Project/src/main.rs").unwrap(),
            PathBuf::from("Project/src/main.rs")
        );
    }

    #[tokio::test]
    async fn resumes_verified_chunks_and_never_overwrites_destination() {
        let root =
            std::env::temp_dir().join(format!("directdrop-receive-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        fs::write(root.join("safe.bin"), b"existing").await.unwrap();
        let manifest = vec![file("safe.bin", 4)];
        let (mut session, offsets) =
            ReceiveSession::prepare(root.clone(), "transfer-12345678", &manifest)
                .await
                .unwrap();
        assert_eq!(offsets[0].offset, 0);
        session
            .write_chunk(&manifest[0].id, 0, &sha256_hex(b"data"), b"data")
            .await
            .unwrap();
        drop(session);

        let partial = root.join(".directdrop-partial/transfer-12345678/files/safe.bin");
        let mut partial_file = OpenOptions::new()
            .append(true)
            .open(&partial)
            .await
            .unwrap();
        partial_file.write_all(b"unverified-tail").await.unwrap();
        partial_file.sync_all().await.unwrap();
        drop(partial_file);

        let (session, offsets) =
            ReceiveSession::prepare(root.clone(), "transfer-12345678", &manifest)
                .await
                .unwrap();
        assert_eq!(offsets[0].offset, 4);
        assert_eq!(fs::metadata(&partial).await.unwrap().len(), 4);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join(".directdrop-partial/transfer-12345678/state.json"))
                    .await
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let destinations = session.complete().await.unwrap();
        assert_eq!(fs::read(root.join("safe.bin")).await.unwrap(), b"existing");
        assert_eq!(fs::read(&destinations[0]).await.unwrap(), b"data");
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn rejects_corrupted_chunk_before_writing() {
        let root =
            std::env::temp_dir().join(format!("directdrop-corrupt-{}", uuid::Uuid::new_v4()));
        let manifest = vec![file("safe.bin", 4)];
        let (mut session, _) =
            ReceiveSession::prepare(root.clone(), "transfer-12345678", &manifest)
                .await
                .unwrap();
        assert!(matches!(
            session
                .write_chunk(&manifest[0].id, 0, &sha256_hex(b"good"), b"evil")
                .await,
            Err(NearbyError::Integrity)
        ));
        assert_eq!(session.transferred_bytes(), 0);
        session.cancel().await.unwrap();
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn preserves_a_selected_folder_and_avoids_overwriting_it() {
        let root = std::env::temp_dir().join(format!("directdrop-folder-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("Project")).await.unwrap();
        fs::write(root.join("Project/original.txt"), b"keep")
            .await
            .unwrap();
        let manifest = vec![file("Project/src/main.rs", 4)];
        let (mut session, _) =
            ReceiveSession::prepare(root.clone(), "transfer-12345678", &manifest)
                .await
                .unwrap();
        session
            .write_chunk(&manifest[0].id, 0, &sha256_hex(b"data"), b"data")
            .await
            .unwrap();
        let destinations = session.complete().await.unwrap();
        assert_eq!(destinations[0].file_name().unwrap(), "Project (1)");
        assert_eq!(
            fs::read(destinations[0].join("src/main.rs")).await.unwrap(),
            b"data"
        );
        assert_eq!(
            fs::read(root.join("Project/original.txt")).await.unwrap(),
            b"keep"
        );
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn completes_an_empty_file_without_allocating_a_chunk() {
        let root = std::env::temp_dir().join(format!("directdrop-empty-{}", uuid::Uuid::new_v4()));
        let manifest = vec![file("empty.txt", 0)];
        let (session, offsets) =
            ReceiveSession::prepare(root.clone(), "transfer-12345678", &manifest)
                .await
                .unwrap();
        assert_eq!(offsets[0].offset, 0);
        let destinations = session.complete().await.unwrap();
        assert_eq!(fs::metadata(&destinations[0]).await.unwrap().len(), 0);
        fs::remove_dir_all(root).await.unwrap();
    }
}
