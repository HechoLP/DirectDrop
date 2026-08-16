use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{
    ipc::Response,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use thiserror::Error;
use uuid::Uuid;

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
}

struct AppState {
    database: Mutex<Connection>,
    active_shares: AtomicUsize,
}

fn modified_millis(path: &Path) -> Result<u64, DirectDropError> {
    let modified = path.metadata()?.modified()?;
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
    let database = state
        .database
        .lock()
        .expect("local registry mutex poisoned");
    let mut result = Vec::with_capacity(paths.len());
    for raw_path in paths {
        let path = PathBuf::from(&raw_path).canonicalize()?;
        let metadata = path.metadata()?;
        if !metadata.is_file() {
            return Err(DirectDropError::Directory(raw_path));
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(DirectDropError::InvalidName)?
            .to_owned();
        let id = Uuid::new_v4().to_string();
        let modified_at = modified_millis(&path)?;
        let mime_type = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .essence_str()
            .to_owned();
        let _readonly = open_readonly(&path)?;
        database.execute(
            "INSERT INTO local_files (public_id, local_path, display_name, size, mime_type, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, path.to_string_lossy(), name, metadata.len(), mime_type, modified_at],
        )?;
        result.push(PublicFile {
            id,
            name,
            size: metadata.len(),
            mime_type,
            modified_at,
        });
    }
    Ok(result)
}

#[tauri::command]
fn read_file_chunk(
    public_file_id: String,
    offset: u64,
    length: usize,
    state: State<'_, AppState>,
) -> Result<Response, DirectDropError> {
    let (path, expected_size, expected_modified): (String, u64, u64) = {
        let database = state
            .database
            .lock()
            .expect("local registry mutex poisoned");
        database
            .query_row(
                "SELECT local_path, size, modified_at FROM local_files WHERE public_id = ?1",
                params![public_file_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| DirectDropError::MissingFile)?
    };
    let path = PathBuf::from(path);
    let metadata = path.metadata().map_err(|_| DirectDropError::MissingFile)?;
    if metadata.len() != expected_size || modified_millis(&path)? != expected_modified {
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
    let mut file = open_readonly(&path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = vec![0_u8; read_len];
    file.read_exact(&mut buffer)?;
    Ok(Response::new(buffer))
}

#[tauri::command]
fn remove_local_files(
    public_file_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), DirectDropError> {
    let database = state
        .database
        .lock()
        .expect("local registry mutex poisoned");
    delete_registry_rows(&database, &public_file_ids)
}

#[tauri::command]
fn set_active_share_count(count: usize, state: State<'_, AppState>) {
    state.active_shares.store(count, Ordering::Relaxed);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
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
           size INTEGER NOT NULL,
           mime_type TEXT NOT NULL,
           modified_at INTEGER NOT NULL
         );",
    )?;
    Ok(connection)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("DirectDrop")
                .build(),
        )
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("directdrop.sqlite3");
            app.manage(AppState {
                database: Mutex::new(initialize_database(database_path)?),
                active_shares: AtomicUsize::new(0),
            });

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
            read_file_chunk,
            remove_local_files,
            set_active_share_count,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running DirectDrop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removing_registry_rows_never_deletes_the_source_file() {
        let source_path =
            std::env::temp_dir().join(format!("directdrop-source-{}", Uuid::new_v4()));
        std::fs::write(&source_path, b"original data").unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE local_files (public_id TEXT PRIMARY KEY, local_path TEXT NOT NULL);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO local_files VALUES ('id', ?1)",
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
}
