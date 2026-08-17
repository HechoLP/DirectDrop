use std::{
    collections::HashSet,
    fs::{File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{
    ipc::Response,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use thiserror::Error;
use uuid::Uuid;

mod nearby;

use nearby::{
    sanitize_filename, LanFile, LocalSource, NearbyManager, NearbyStatus, NearbyTransferSnapshot,
    PairingTicket,
};

const MAX_REGISTERED_FILES_PER_REQUEST: usize = 100;
const MAX_NEARBY_FILES_PER_REQUEST: usize = 10_000;
const MAX_REMOVED_FILES_PER_REQUEST: usize = 1_000;
const MAX_READ_CHUNK_SIZE: usize = 1024 * 1024;

#[derive(Debug, Error)]
enum DirectDropError {
    #[error("파일을 찾을 수 없습니다.")]
    MissingFile,
    #[error("공유 이후 파일이 이동되거나 변경되었습니다: {0}")]
    FileChanged(String),
    #[error("폴더는 공유할 수 없습니다: {0}")]
    Directory(String),
    #[error("파일 이름을 읽을 수 없습니다.")]
    InvalidName,
    #[error("한 번에 처리할 수 있는 파일 수를 초과했습니다.")]
    TooManyFiles,
    #[error("파일 읽기 요청 크기가 올바르지 않습니다.")]
    InvalidChunkLength,
    #[error("로컬 파일 레지스트리를 사용할 수 없습니다.")]
    RegistryUnavailable,
    #[error("I/O 오류: {0}")]
    Io(#[from] std::io::Error),
    #[error("로컬 레지스트리 오류: {0}")]
    Database(#[from] rusqlite::Error),
}

impl serde::Serialize for DirectDropError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicFile {
    id: String,
    name: String,
    size: u64,
    mime_type: String,
    modified_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    relative_path: Option<String>,
}

struct AppState {
    database: Mutex<Connection>,
    active_shares: AtomicUsize,
}

fn metadata_modified_millis(metadata: &Metadata) -> Result<u64, DirectDropError> {
    let modified = metadata.modified()?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64)
}

fn open_readonly(path: &Path) -> Result<File, DirectDropError> {
    Ok(OpenOptions::new().read(true).write(false).open(path)?)
}

fn delete_registry_rows(
    database: &Connection,
    public_file_ids: &[String],
) -> Result<(), DirectDropError> {
    let mut statement = database.prepare("DELETE FROM local_files WHERE public_id = ?1")?;
    for public_id in public_file_ids {
        statement.execute(params![public_id])?;
    }
    Ok(())
}

#[tauri::command]
fn register_files(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PublicFile>, DirectDropError> {
    if paths.len() > MAX_REGISTERED_FILES_PER_REQUEST {
        return Err(DirectDropError::TooManyFiles);
    }
    let mut prepared = Vec::with_capacity(paths.len());
    for raw_path in paths {
        let path = PathBuf::from(&raw_path).canonicalize()?;
        let readonly = open_readonly(&path)?;
        let metadata = readonly.metadata()?;
        if !metadata.is_file() {
            return Err(DirectDropError::Directory(raw_path));
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(DirectDropError::InvalidName)?
            .to_owned();
        let id = Uuid::new_v4().to_string();
        let modified_at = metadata_modified_millis(&metadata)?;
        let mime_type = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .essence_str()
            .to_owned();
        prepared.push((id, path, name, metadata.len(), mime_type, modified_at));
    }

    let mut database = state
        .database
        .lock()
        .map_err(|_| DirectDropError::RegistryUnavailable)?;
    let transaction = database.transaction()?;
    let mut result = Vec::with_capacity(prepared.len());
    for (id, path, name, size, mime_type, modified_at) in prepared {
        transaction.execute(
            "INSERT INTO local_files (public_id, local_path, display_name, size, mime_type, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, path.to_string_lossy(), name, size, mime_type, modified_at],
        )?;
        result.push(PublicFile {
            id,
            name,
            size,
            mime_type,
            modified_at,
            relative_path: None,
        });
    }
    transaction.commit()?;
    Ok(result)
}

#[derive(Debug)]
struct PreparedNearbyFile {
    path: PathBuf,
    relative_path: String,
}

fn collect_nearby_files(
    path: &Path,
    relative_path: &Path,
    output: &mut Vec<PreparedNearbyFile>,
) -> Result<(), DirectDropError> {
    if output.len() >= MAX_NEARBY_FILES_PER_REQUEST {
        return Err(DirectDropError::TooManyFiles);
    }
    let symlink_metadata = std::fs::symlink_metadata(path)?;
    if symlink_metadata.file_type().is_symlink() {
        return Err(DirectDropError::FileChanged(
            "심볼릭 링크는 Nearby 폴더 전송에서 사용할 수 없습니다.".to_owned(),
        ));
    }
    if symlink_metadata.is_file() {
        output.push(PreparedNearbyFile {
            path: path.to_path_buf(),
            relative_path: relative_path.to_string_lossy().replace('\\', "/"),
        });
        return Ok(());
    }
    if !symlink_metadata.is_dir() {
        return Err(DirectDropError::Directory(
            path.to_string_lossy().to_string(),
        ));
    }
    let mut entries = std::fs::read_dir(path)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| DirectDropError::InvalidName)?;
        let safe_name = sanitize_filename(&name);
        collect_nearby_files(&entry.path(), &relative_path.join(safe_name), output)?;
    }
    Ok(())
}

#[tauri::command]
fn register_nearby_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PublicFile>, DirectDropError> {
    if paths.len() > MAX_REGISTERED_FILES_PER_REQUEST {
        return Err(DirectDropError::TooManyFiles);
    }
    let mut collected = Vec::new();
    let mut seen = HashSet::new();
    for raw_path in paths {
        let original = PathBuf::from(&raw_path);
        let metadata = std::fs::symlink_metadata(&original)?;
        if metadata.file_type().is_symlink() {
            return Err(DirectDropError::FileChanged(
                "심볼릭 링크는 Nearby 전송에서 사용할 수 없습니다.".to_owned(),
            ));
        }
        let canonical = original.canonicalize()?;
        if !seen.insert(canonical.clone()) {
            continue;
        }
        let root_name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(DirectDropError::InvalidName)?;
        collect_nearby_files(
            &canonical,
            Path::new(&sanitize_filename(root_name)),
            &mut collected,
        )?;
    }
    if collected.is_empty() {
        return Err(DirectDropError::MissingFile);
    }
    let mut relative_paths = HashSet::with_capacity(collected.len());
    if collected
        .iter()
        .any(|item| !relative_paths.insert(item.relative_path.clone()))
    {
        return Err(DirectDropError::FileChanged(
            "안전한 파일 이름으로 변환한 뒤 경로가 서로 충돌합니다.".to_owned(),
        ));
    }

    let mut prepared = Vec::with_capacity(collected.len());
    for item in collected {
        let readonly = open_readonly(&item.path)?;
        let metadata = readonly.metadata()?;
        if !metadata.is_file() {
            return Err(DirectDropError::Directory(
                item.path.to_string_lossy().to_string(),
            ));
        }
        let name = item
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(DirectDropError::InvalidName)
            .map(sanitize_filename)?;
        let id = Uuid::new_v4().to_string();
        let modified_at = metadata_modified_millis(&metadata)?;
        let mime_type = mime_guess::from_path(&item.path)
            .first_or_octet_stream()
            .essence_str()
            .to_owned();
        prepared.push((
            id,
            item.path,
            name,
            item.relative_path,
            metadata.len(),
            mime_type,
            modified_at,
        ));
    }

    let mut database = state
        .database
        .lock()
        .map_err(|_| DirectDropError::RegistryUnavailable)?;
    let transaction = database.transaction()?;
    let mut result = Vec::with_capacity(prepared.len());
    for (id, path, name, relative_path, size, mime_type, modified_at) in prepared {
        transaction.execute(
            "INSERT INTO local_files (public_id, local_path, display_name, relative_path, size, mime_type, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, path.to_string_lossy(), name, relative_path, size, mime_type, modified_at],
        )?;
        result.push(PublicFile {
            id,
            name,
            size,
            mime_type,
            modified_at,
            relative_path: Some(relative_path),
        });
    }
    transaction.commit()?;
    Ok(result)
}

fn read_registered_chunk(
    database: &Connection,
    public_file_id: &str,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, DirectDropError> {
    if length == 0 || length > MAX_READ_CHUNK_SIZE {
        return Err(DirectDropError::InvalidChunkLength);
    }
    let (path, expected_size, expected_modified): (String, u64, u64) = database
        .query_row(
            "SELECT local_path, size, modified_at FROM local_files WHERE public_id = ?1",
            params![public_file_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(DirectDropError::MissingFile)?;
    let path = PathBuf::from(path);
    let mut file = open_readonly(&path).map_err(|_| DirectDropError::MissingFile)?;
    let metadata = file.metadata().map_err(|_| DirectDropError::MissingFile)?;
    if metadata.len() != expected_size || metadata_modified_millis(&metadata)? != expected_modified
    {
        return Err(DirectDropError::FileChanged(
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
                .to_owned(),
        ));
    }
    if offset > expected_size {
        return Err(DirectDropError::FileChanged("invalid offset".to_owned()));
    }
    let read_len = length.min((expected_size - offset) as usize);
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = vec![0_u8; read_len];
    file.read_exact(&mut buffer)?;
    Ok(buffer)
}

#[tauri::command]
fn read_file_chunk(
    public_file_id: String,
    offset: u64,
    length: usize,
    state: State<'_, AppState>,
) -> Result<Response, DirectDropError> {
    let database = state
        .database
        .lock()
        .map_err(|_| DirectDropError::RegistryUnavailable)?;
    Ok(Response::new(read_registered_chunk(
        &database,
        &public_file_id,
        offset,
        length,
    )?))
}

#[tauri::command]
fn remove_local_files(
    public_file_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), DirectDropError> {
    if public_file_ids.len() > MAX_REMOVED_FILES_PER_REQUEST {
        return Err(DirectDropError::TooManyFiles);
    }
    let database = state
        .database
        .lock()
        .map_err(|_| DirectDropError::RegistryUnavailable)?;
    delete_registry_rows(&database, &public_file_ids)
}

#[tauri::command]
fn set_active_share_count(count: usize, state: State<'_, AppState>) {
    state.active_shares.store(count, Ordering::Relaxed);
}

#[tauri::command]
fn quit_app(app: AppHandle, nearby: State<'_, NearbyManager>) {
    let _ = nearby.stop();
    app.exit(0);
}

#[tauri::command]
async fn nearby_start(
    manager: State<'_, NearbyManager>,
) -> Result<NearbyStatus, nearby::NearbyError> {
    manager.start().await
}

#[tauri::command]
fn nearby_stop(manager: State<'_, NearbyManager>) -> Result<NearbyStatus, nearby::NearbyError> {
    manager.stop()
}

#[tauri::command]
fn nearby_status(manager: State<'_, NearbyManager>) -> Result<NearbyStatus, nearby::NearbyError> {
    manager.status()
}

#[tauri::command]
async fn nearby_update_preferences(
    enabled: bool,
    device_name: String,
    download_directory: String,
    manager: State<'_, NearbyManager>,
) -> Result<NearbyStatus, nearby::NearbyError> {
    manager
        .update_preferences(enabled, device_name, download_directory)
        .await
}

#[tauri::command]
async fn nearby_begin_pairing(
    device_id: String,
    manager: State<'_, NearbyManager>,
) -> Result<PairingTicket, nearby::NearbyError> {
    manager.begin_pairing(&device_id).await
}

#[tauri::command]
fn nearby_decide_pairing(
    pairing_id: String,
    accepted: bool,
    manager: State<'_, NearbyManager>,
) -> Result<(), nearby::NearbyError> {
    manager.decide_pairing(&pairing_id, accepted)
}

#[tauri::command]
fn nearby_forget_device(
    device_id: String,
    manager: State<'_, NearbyManager>,
) -> Result<NearbyStatus, nearby::NearbyError> {
    manager.forget_device(&device_id)
}

#[tauri::command]
fn nearby_set_auto_accept_files(
    device_id: String,
    enabled: bool,
    manager: State<'_, NearbyManager>,
) -> Result<NearbyStatus, nearby::NearbyError> {
    manager.set_auto_accept_files(&device_id, enabled)
}

#[tauri::command]
fn nearby_send_files(
    device_id: String,
    public_file_ids: Vec<String>,
    state: State<'_, AppState>,
    manager: State<'_, NearbyManager>,
) -> Result<String, nearby::NearbyError> {
    if public_file_ids.is_empty() || public_file_ids.len() > MAX_NEARBY_FILES_PER_REQUEST {
        return Err(nearby::NearbyError::InvalidInput(
            "전송할 파일 수가 올바르지 않습니다.".to_owned(),
        ));
    }
    let database = state
        .database
        .lock()
        .map_err(|_| nearby::NearbyError::StateUnavailable)?;
    let mut statement = database
        .prepare(
            "SELECT local_path, display_name, COALESCE(relative_path, display_name), size, mime_type, modified_at FROM local_files WHERE public_id = ?1",
        )
        .map_err(|error| nearby::NearbyError::Protocol(error.to_string()))?;
    let mut sources = Vec::with_capacity(public_file_ids.len());
    for public_id in public_file_ids {
        let source = statement
            .query_row(params![public_id], |row| {
                Ok(LocalSource {
                    path: PathBuf::from(row.get::<_, String>(0)?),
                    file: LanFile {
                        id: public_id.clone(),
                        name: row.get(1)?,
                        relative_path: row.get(2)?,
                        size: row.get(3)?,
                        mime_type: row.get(4)?,
                        modified_at: row.get(5)?,
                    },
                })
            })
            .optional()
            .map_err(|error| nearby::NearbyError::Protocol(error.to_string()))?
            .ok_or(nearby::NearbyError::NotFound)?;
        sources.push(source);
    }
    manager.send_files(&device_id, sources)
}

#[tauri::command]
fn nearby_decide_transfer(
    transfer_id: String,
    accepted: bool,
    manager: State<'_, NearbyManager>,
) -> Result<(), nearby::NearbyError> {
    manager.decide_transfer(&transfer_id, accepted)
}

#[tauri::command]
fn nearby_pause_transfer(
    transfer_id: String,
    manager: State<'_, NearbyManager>,
) -> Result<(), nearby::NearbyError> {
    manager.pause_transfer(&transfer_id)
}

#[tauri::command]
fn nearby_resume_transfer(
    transfer_id: String,
    manager: State<'_, NearbyManager>,
) -> Result<(), nearby::NearbyError> {
    manager.resume_transfer(&transfer_id)
}

#[tauri::command]
fn nearby_retry_transfer(
    transfer_id: String,
    manager: State<'_, NearbyManager>,
) -> Result<(), nearby::NearbyError> {
    manager.retry_transfer(&transfer_id)
}

#[tauri::command]
fn nearby_cancel_transfer(
    transfer_id: String,
    manager: State<'_, NearbyManager>,
) -> Result<(), nearby::NearbyError> {
    manager.cancel_transfer(&transfer_id)
}

#[tauri::command]
fn nearby_transfers(
    manager: State<'_, NearbyManager>,
) -> Result<Vec<NearbyTransferSnapshot>, nearby::NearbyError> {
    manager.transfers()
}

fn initialize_database(path: PathBuf) -> Result<Connection, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS local_files (
           public_id TEXT PRIMARY KEY,
           local_path TEXT NOT NULL,
           display_name TEXT NOT NULL,
           relative_path TEXT,
           size INTEGER NOT NULL,
           mime_type TEXT NOT NULL,
           modified_at INTEGER NOT NULL
         );",
    )?;
    let columns = {
        let mut statement = connection.prepare("PRAGMA table_info(local_files)")?;
        let result = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        result
    };
    if !columns.iter().any(|column| column == "relative_path") {
        connection.execute("ALTER TABLE local_files ADD COLUMN relative_path TEXT", [])?;
    }
    Ok(connection)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("DirectDrop")
                .build(),
        )
        .setup(|app| {
            let app_data_directory = app.path().app_data_dir()?;
            let database_path = app_data_directory.join("directdrop.sqlite3");
            app.manage(AppState {
                database: Mutex::new(initialize_database(database_path)?),
                active_shares: AtomicUsize::new(0),
            });
            let nearby = NearbyManager::new(app.handle().clone(), app_data_directory)
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let nearby_start = nearby.clone();
            let enabled = nearby
                .status()
                .map(|status| status.preferences.enabled)
                .unwrap_or(false);
            app.manage(nearby);
            if enabled {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = nearby_start.start().await {
                        eprintln!("DirectDrop Nearby startup failed: {error}");
                    }
                });
            }

            let open_item = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop", "모든 공유 중지", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &stop_item, &quit_item])?;
            TrayIconBuilder::new()
                .tooltip("DirectDrop")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "stop" => {
                        let _ = app.emit("stop-all-shares", ());
                    }
                    "quit" => {
                        let _ = app.emit("quit-requested", ());
                    }
                    _ => {}
                })
                .build(app)?;
            #[cfg(debug_assertions)]
            if std::env::var_os("DIRECTDROP_OPEN_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            #[cfg(feature = "debug-inspector")]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            register_files,
            register_nearby_paths,
            read_file_chunk,
            remove_local_files,
            set_active_share_count,
            quit_app,
            nearby_start,
            nearby_stop,
            nearby_status,
            nearby_update_preferences,
            nearby_begin_pairing,
            nearby_decide_pairing,
            nearby_forget_device,
            nearby_set_auto_accept_files,
            nearby_send_files,
            nearby_decide_transfer,
            nearby_pause_transfer,
            nearby_resume_transfer,
            nearby_retry_transfer,
            nearby_cancel_transfer,
            nearby_transfers
        ])
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_registry() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE local_files (
                    public_id TEXT PRIMARY KEY,
                    local_path TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    relative_path TEXT,
                    size INTEGER NOT NULL,
                    mime_type TEXT NOT NULL,
                    modified_at INTEGER NOT NULL
                );",
            )
            .unwrap();
        connection
    }

    #[test]
    fn removing_registry_rows_never_deletes_the_source_file() {
        let source_path =
            std::env::temp_dir().join(format!("directdrop-source-{}", Uuid::new_v4()));
        std::fs::write(&source_path, b"original data").unwrap();
        let connection = test_registry();
        connection
            .execute(
                "INSERT INTO local_files VALUES ('id', ?1, 'source', NULL, 13, 'application/octet-stream', 0)",
                params![source_path.to_string_lossy()],
            )
            .unwrap();
        delete_registry_rows(&connection, &["id".to_owned()]).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM local_files", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(std::fs::read(&source_path).unwrap(), b"original data");
        std::fs::remove_file(source_path).unwrap();
    }

    #[test]
    fn chunk_reader_rejects_unregistered_paths_and_oversized_reads() {
        let connection = test_registry();
        assert!(matches!(
            read_registered_chunk(&connection, "../../etc/passwd", 0, 1024),
            Err(DirectDropError::MissingFile)
        ));
        assert!(matches!(
            read_registered_chunk(&connection, "missing-id", 0, MAX_READ_CHUNK_SIZE + 1),
            Err(DirectDropError::InvalidChunkLength)
        ));
        assert!(matches!(
            read_registered_chunk(&connection, "missing-id", 0, 0),
            Err(DirectDropError::InvalidChunkLength)
        ));
    }

    #[test]
    fn chunk_reader_only_reads_the_registered_file_range() {
        let source_path =
            std::env::temp_dir().join(format!("directdrop-chunk-source-{}", Uuid::new_v4()));
        std::fs::write(&source_path, b"0123456789").unwrap();
        let canonical = source_path.canonicalize().unwrap();
        let connection = test_registry();
        connection
            .execute(
                "INSERT INTO local_files VALUES ('registered-id', ?1, 'source', NULL, ?2, 'application/octet-stream', ?3)",
                params![
                    canonical.to_string_lossy(),
                    10_u64,
                    metadata_modified_millis(&canonical.metadata().unwrap()).unwrap()
                ],
            )
            .unwrap();

        assert_eq!(
            read_registered_chunk(&connection, "registered-id", 3, 4).unwrap(),
            b"3456"
        );
        assert!(matches!(
            read_registered_chunk(&connection, "registered-id", 11, 1),
            Err(DirectDropError::FileChanged(_))
        ));
        assert_eq!(std::fs::read(&source_path).unwrap(), b"0123456789");
        std::fs::remove_file(source_path).unwrap();
    }

    #[test]
    fn chunk_reader_handles_offsets_beyond_four_gibibytes() {
        let source_path =
            std::env::temp_dir().join(format!("directdrop-sparse-source-{}", Uuid::new_v4()));
        let expected_size = 4 * 1024_u64.pow(3) + 17;
        let mut source = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&source_path)
            .unwrap();
        source.set_len(expected_size).unwrap();
        source.seek(SeekFrom::Start(expected_size - 1)).unwrap();
        std::io::Write::write_all(&mut source, &[0x7f]).unwrap();
        drop(source);

        let canonical = source_path.canonicalize().unwrap();
        let connection = test_registry();
        connection
            .execute(
                "INSERT INTO local_files VALUES ('large-file-id', ?1, 'large.bin', NULL, ?2, 'application/octet-stream', ?3)",
                params![
                    canonical.to_string_lossy(),
                    expected_size,
                    metadata_modified_millis(&canonical.metadata().unwrap()).unwrap()
                ],
            )
            .unwrap();

        assert_eq!(
            read_registered_chunk(&connection, "large-file-id", expected_size - 1, 1).unwrap(),
            [0x7f]
        );
        std::fs::remove_file(source_path).unwrap();
    }
}
