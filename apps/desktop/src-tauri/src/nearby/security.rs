use std::{collections::HashSet, path::Path};

use serde::Serialize;
use tokio::{fs, io::AsyncReadExt};

use super::{protocol::LanFile, storage::validate_relative_path, NearbyError};

const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "app", "apk", "appimage", "bin", "com", "cpl", "deb", "dll", "dylib", "exe", "gadget", "jar",
    "msi", "msp", "pif", "pkg", "rpm", "scr", "sys",
];
const SCRIPT_EXTENSIONS: &[&str] = &[
    "bat", "cmd", "command", "desktop", "fish", "hta", "inf", "ins", "isp", "job", "jse", "js",
    "lnk", "msh", "msh1", "msh2", "mst", "php", "pl", "ps1", "psd1", "psm1", "py", "rb", "reg",
    "scf", "sct", "sh", "url", "vb", "vbe", "vbs", "webloc", "workflow", "wsc", "wsf", "wsh",
    "xnk", "zsh",
];
const MACRO_EXTENSIONS: &[&str] = &[
    "chm", "doc", "docm", "dot", "dotm", "iqy", "one", "pot", "potm", "ppam", "pps", "ppsm", "ppt",
    "pptm", "rtf", "sldm", "slk", "xla", "xlam", "xll", "xls", "xlsb", "xlsm", "xlt", "xltm",
];
const ARCHIVE_EXTENSIONS: &[&str] = &[
    "7z", "bz2", "cab", "dmg", "gz", "img", "iso", "lz", "lzma", "rar", "tar", "tgz", "txz", "vhd",
    "vhdx", "xz", "zip",
];
const ACTIVE_WEB_EXTENSIONS: &[&str] = &["htm", "html", "mht", "mhtml", "svg", "xhtml"];
const DECOY_EXTENSIONS: &[&str] = &[
    "csv", "doc", "docx", "gif", "jpeg", "jpg", "mp3", "mp4", "pdf", "png", "ppt", "pptx", "rtf",
    "txt", "xls", "xlsx",
];
const HIGH_RISK_REASONS: &[&str] = &[
    "EXECUTABLE_OR_INSTALLER",
    "SCRIPT_OR_SHORTCUT",
    "MACRO_DOCUMENT",
    "DECEPTIVE_DOUBLE_EXTENSION",
    "ACTIVE_MIME_MISMATCH",
    "EXECUTABLE_CONTENT_MISMATCH",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSecurityAssessment {
    pub verdict: String,
    pub risk_level: String,
    pub requires_explicit_approval: bool,
    pub risky_file_count: usize,
    pub reasons: Vec<String>,
}

impl FileSecurityAssessment {
    pub fn risk_rank(&self) -> u8 {
        match self.risk_level.as_str() {
            "HIGH_RISK" => 2,
            "CAUTION" => 1,
            _ => 0,
        }
    }
}

pub fn assess_manifest(files: &[LanFile]) -> FileSecurityAssessment {
    let mut all_reasons = Vec::new();
    let mut risky_file_count = 0;

    for file in files {
        let reasons = assess_file(file);
        if !reasons.is_empty() {
            risky_file_count += 1;
        }
        for reason in reasons {
            push_reason(&mut all_reasons, reason);
        }
    }

    build_assessment(risky_file_count, all_reasons)
}

pub async fn inspect_staged_files(
    root: &Path,
    files: &[LanFile],
) -> Result<FileSecurityAssessment, NearbyError> {
    let mut assessment = assess_manifest(files);
    for file in files {
        let relative = validate_relative_path(&file.relative_path)?;
        let path = root.join(relative);
        let metadata = fs::symlink_metadata(&path).await?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(NearbyError::Security(
                "격리 영역에 예상하지 못한 파일 형식이 있습니다.".to_owned(),
            ));
        }
        let mut handle = fs::File::open(&path).await?;
        let mut header = vec![0_u8; 1024 * 1024];
        let read = handle.read(&mut header).await?;
        header.truncate(read);
        if detect_active_content(&header).is_some()
            && !assess_file(file)
                .iter()
                .any(|reason| HIGH_RISK_REASONS.contains(&reason.as_str()))
        {
            if assess_file(file).is_empty() {
                assessment.risky_file_count += 1;
            }
            push_reason(
                &mut assessment.reasons,
                "EXECUTABLE_CONTENT_MISMATCH".to_owned(),
            );
            assessment.risk_level = "HIGH_RISK".to_owned();
            assessment.requires_explicit_approval = true;
        }
    }
    Ok(assessment)
}

pub async fn apply_platform_protection(root: &Path, transfer_id: &str) -> Result<(), NearbyError> {
    if transfer_id.len() < 8
        || transfer_id.len() > 128
        || !transfer_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(NearbyError::Security(
            "보호 메타데이터에 사용할 수 없는 전송 식별자입니다.".to_owned(),
        ));
    }
    let root = root.to_path_buf();
    let transfer_id = transfer_id.to_owned();
    tokio::task::spawn_blocking(move || protect_tree(&root, &transfer_id))
        .await
        .map_err(|error| NearbyError::Security(format!("보호 처리 작업 실패: {error}")))??;
    Ok(())
}

fn assess_file(file: &LanFile) -> Vec<String> {
    let path = file.relative_path.to_ascii_lowercase();
    let filename = path.rsplit('/').next().unwrap_or(path.as_str());
    let extensions = filename
        .split('.')
        .skip(1)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let extension = extensions.last().copied().unwrap_or_default();
    let mime = file.mime_type.to_ascii_lowercase();
    let mut reasons = Vec::new();

    if EXECUTABLE_EXTENSIONS.contains(&extension)
        || path.split('/').any(|segment| segment.ends_with(".app"))
        || mime.contains("executable")
        || mime.contains("x-msdownload")
        || mime.contains("java-archive")
        || mime.contains("msi")
    {
        push_reason(&mut reasons, "EXECUTABLE_OR_INSTALLER".to_owned());
    }
    if SCRIPT_EXTENSIONS.contains(&extension)
        || mime.contains("javascript")
        || mime.contains("x-sh")
        || mime.contains("powershell")
    {
        push_reason(&mut reasons, "SCRIPT_OR_SHORTCUT".to_owned());
    }
    if MACRO_EXTENSIONS.contains(&extension) || mime.contains("macroenabled") {
        push_reason(&mut reasons, "MACRO_DOCUMENT".to_owned());
    }
    if ARCHIVE_EXTENSIONS.contains(&extension)
        || mime.contains("compressed")
        || mime.contains("archive")
        || mime.contains("x-7z")
        || mime.contains("rar")
        || mime.contains("zip")
    {
        push_reason(&mut reasons, "ARCHIVE_OR_DISK_IMAGE".to_owned());
    }
    if ACTIVE_WEB_EXTENSIONS.contains(&extension) || mime == "text/html" || mime == "image/svg+xml"
    {
        push_reason(&mut reasons, "ACTIVE_WEB_CONTENT".to_owned());
    }
    if extensions.len() >= 2
        && DECOY_EXTENSIONS.contains(&extensions[extensions.len() - 2])
        && (EXECUTABLE_EXTENSIONS.contains(&extension) || SCRIPT_EXTENSIONS.contains(&extension))
    {
        push_reason(&mut reasons, "DECEPTIVE_DOUBLE_EXTENSION".to_owned());
    }
    if DECOY_EXTENSIONS.contains(&extension)
        && (mime.contains("executable")
            || mime.contains("x-msdownload")
            || mime.contains("javascript")
            || mime.contains("powershell"))
    {
        push_reason(&mut reasons, "ACTIVE_MIME_MISMATCH".to_owned());
    }
    reasons
}

fn build_assessment(risky_file_count: usize, reasons: Vec<String>) -> FileSecurityAssessment {
    let risk_level = if reasons
        .iter()
        .any(|reason| HIGH_RISK_REASONS.contains(&reason.as_str()))
    {
        "HIGH_RISK"
    } else if reasons.is_empty() {
        "LOWER_RISK"
    } else {
        "CAUTION"
    };
    FileSecurityAssessment {
        verdict: "UNSCANNED".to_owned(),
        risk_level: risk_level.to_owned(),
        requires_explicit_approval: risk_level != "LOWER_RISK",
        risky_file_count,
        reasons,
    }
}

fn push_reason(reasons: &mut Vec<String>, reason: String) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}

fn detect_active_content(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 64 && bytes.starts_with(b"MZ") {
        let pe_offset = u32::from_le_bytes(bytes[0x3c..0x40].try_into().ok()?) as usize;
        if pe_offset <= bytes.len().saturating_sub(4)
            && &bytes[pe_offset..pe_offset + 4] == b"PE\0\0"
        {
            return Some("WINDOWS_EXECUTABLE");
        }
    }
    if bytes.starts_with(b"\x7fELF") {
        return Some("ELF_EXECUTABLE");
    }
    if bytes.len() >= 4 {
        let magic: [u8; 4] = bytes[..4].try_into().ok()?;
        if [
            [0xca, 0xfe, 0xba, 0xbe],
            [0xbe, 0xba, 0xfe, 0xca],
            [0xfe, 0xed, 0xfa, 0xce],
            [0xce, 0xfa, 0xed, 0xfe],
            [0xfe, 0xed, 0xfa, 0xcf],
            [0xcf, 0xfa, 0xed, 0xfe],
        ]
        .contains(&magic)
        {
            return Some("MACHO_EXECUTABLE");
        }
    }
    bytes.starts_with(b"#!").then_some("SCRIPT_SHEBANG")
}

fn protect_tree(root: &Path, transfer_id: &str) -> Result<(), NearbyError> {
    let mut pending = vec![root.to_path_buf()];
    let mut visited = HashSet::new();
    while let Some(path) = pending.pop() {
        if !visited.insert(path.clone()) {
            return Err(NearbyError::Security(
                "격리 영역에서 중복 경로를 발견했습니다.".to_owned(),
            ));
        }
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(NearbyError::Security(
                "격리 영역의 심볼릭 링크를 거부했습니다.".to_owned(),
            ));
        }

        #[cfg(target_os = "macos")]
        apply_macos_quarantine(&path, transfer_id)?;

        if metadata.is_dir() {
            for entry in std::fs::read_dir(&path)? {
                pending.push(entry?.path());
            }
        } else if metadata.is_file() {
            #[cfg(unix)]
            clear_executable_bits(&path, &metadata)?;
            #[cfg(windows)]
            apply_windows_mark_of_the_web(&path, transfer_id)?;
        } else {
            return Err(NearbyError::Security(
                "격리 영역에 지원하지 않는 항목이 있습니다.".to_owned(),
            ));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn clear_executable_bits(path: &Path, metadata: &std::fs::Metadata) -> Result<(), NearbyError> {
    use std::os::unix::fs::PermissionsExt;

    let mode = metadata.permissions().mode();
    if mode & 0o111 != 0 {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode & !0o111))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_macos_quarantine(path: &Path, transfer_id: &str) -> Result<(), NearbyError> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| NearbyError::Security(format!("시스템 시간 오류: {error}")))?
        .as_secs();
    let value = format!("0083;{timestamp:x};DirectDrop;nearby://{transfer_id}");
    xattr::set(path, "com.apple.quarantine", value.as_bytes()).map_err(|error| {
        NearbyError::Security(format!("macOS 격리 속성을 적용하지 못했습니다: {error}"))
    })
}

#[cfg(windows)]
fn apply_windows_mark_of_the_web(path: &Path, transfer_id: &str) -> Result<(), NearbyError> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    let mut stream = path.as_os_str().encode_wide().collect::<Vec<_>>();
    stream.extend(":Zone.Identifier".encode_utf16());
    let stream = std::ffi::OsString::from_wide(&stream);
    let metadata = format!(
        "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=nearby://{transfer_id}\r\nReferrerUrl=DirectDrop\r\n"
    );
    std::fs::write(Path::new(&stream), metadata.as_bytes()).map_err(|error| {
        NearbyError::Security(format!(
            "Windows 인터넷 출처 표시를 적용하지 못했습니다: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, mime_type: &str) -> LanFile {
        LanFile {
            id: format!("file-{path}-12345678"),
            name: path.rsplit('/').next().unwrap().to_owned(),
            relative_path: path.to_owned(),
            size: 0,
            mime_type: mime_type.to_owned(),
            modified_at: 0,
        }
    }

    #[test]
    fn classifies_active_files_without_claiming_they_are_malware() {
        let assessment = assess_manifest(&[
            file("invoice.pdf.exe", "application/octet-stream"),
            file("documents.zip", "application/zip"),
        ]);
        assert_eq!(assessment.verdict, "UNSCANNED");
        assert_eq!(assessment.risk_level, "HIGH_RISK");
        assert!(assessment.requires_explicit_approval);
        assert!(assessment
            .reasons
            .contains(&"DECEPTIVE_DOUBLE_EXTENSION".to_owned()));
    }

    #[tokio::test]
    async fn escalates_a_renamed_executable_after_staging() {
        let root =
            std::env::temp_dir().join(format!("directdrop-security-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let mut pe = vec![0_u8; 128];
        pe[..2].copy_from_slice(b"MZ");
        pe[0x3c..0x40].copy_from_slice(&64_u32.to_le_bytes());
        pe[64..68].copy_from_slice(b"PE\0\0");
        fs::write(root.join("notes.txt"), pe).await.unwrap();
        let assessment = inspect_staged_files(&root, &[file("notes.txt", "text/plain")])
            .await
            .unwrap();
        assert_eq!(assessment.risk_level, "HIGH_RISK");
        assert!(assessment
            .reasons
            .contains(&"EXECUTABLE_CONTENT_MISMATCH".to_owned()));
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn rejects_transfer_identifiers_that_could_inject_provenance_metadata() {
        let root = std::env::temp_dir().join(format!("directdrop-origin-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let error = apply_platform_protection(&root, "transfer\r\nZoneId=0")
            .await
            .unwrap_err();
        assert!(matches!(error, NearbyError::Security(_)));
        fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn writes_windows_mark_of_the_web_with_transfer_origin() {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};

        let path =
            std::env::temp_dir().join(format!("directdrop-zone-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"received").unwrap();
        apply_windows_mark_of_the_web(&path, "transfer-12345678").unwrap();

        let mut stream = path.as_os_str().encode_wide().collect::<Vec<_>>();
        stream.extend(":Zone.Identifier".encode_utf16());
        let stream = std::ffi::OsString::from_wide(&stream);
        let metadata = std::fs::read_to_string(Path::new(&stream)).unwrap();
        assert!(metadata.contains("ZoneId=3"));
        assert!(metadata.contains("HostUrl=nearby://transfer-12345678"));

        std::fs::remove_file(path).unwrap();
    }
}
