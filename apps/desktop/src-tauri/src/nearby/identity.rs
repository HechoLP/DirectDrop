use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::{Hmac, KeyInit, Mac};
use rand::{rngs::OsRng, RngCore};
use rcgen::{generate_simple_self_signed, CertifiedKey};
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    ClientConfig, RootCertStore, ServerConfig,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::NearbyError;

type HmacSha256 = Hmac<Sha256>;
const MAX_TRUSTED_DEVICES: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    pub device_id: String,
    pub device_name: String,
    pub certificate_fingerprint: String,
    pub shared_secret: String,
    pub paired_at: u64,
    #[serde(default)]
    pub auto_accept_files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyPreferences {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub device_name: String,
    pub download_directory: String,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdentityFile {
    device_id: String,
    certificate_der: String,
    private_key_der: String,
    certificate_fingerprint: String,
    preferences: NearbyPreferences,
    #[serde(default)]
    trusted_devices: Vec<TrustedDevice>,
}

#[derive(Clone)]
pub struct IdentityStore {
    path: PathBuf,
    inner: Arc<Mutex<IdentityFile>>,
}

impl IdentityStore {
    pub fn load_or_create(base_directory: &Path) -> Result<Self, NearbyError> {
        fs::create_dir_all(base_directory)?;
        let path = base_directory.join("identity.json");
        if path.exists() {
            let identity = read_identity(&path).or_else(|primary_error| {
                let backup = path.with_extension("json.bak");
                if backup.exists() {
                    read_identity(&backup)
                } else {
                    Err(primary_error)
                }
            })?;
            return Ok(Self {
                path,
                inner: Arc::new(Mutex::new(identity)),
            });
        }

        let CertifiedKey { cert, signing_key } =
            generate_simple_self_signed(vec!["directdrop.local".to_owned()])?;
        let certificate_der = cert.der().to_vec();
        let device_name = hostname::get()
            .ok()
            .and_then(|name| name.into_string().ok())
            .map(|name| sanitize_device_name(&name))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "DirectDrop Device".to_owned());
        let download_directory = dirs_download_directory()
            .join("DirectDrop")
            .to_string_lossy()
            .to_string();
        let identity = IdentityFile {
            device_id: uuid::Uuid::new_v4().to_string(),
            certificate_fingerprint: fingerprint(&certificate_der),
            certificate_der: BASE64.encode(certificate_der),
            private_key_der: BASE64.encode(signing_key.serialize_der()),
            preferences: NearbyPreferences {
                enabled: true,
                device_name,
                download_directory,
            },
            trusted_devices: Vec::new(),
        };
        let store = Self {
            path,
            inner: Arc::new(Mutex::new(identity)),
        };
        store.persist()?;
        Ok(store)
    }

    pub fn device_id(&self) -> Result<String, NearbyError> {
        Ok(self.lock()?.device_id.clone())
    }

    pub fn fingerprint(&self) -> Result<String, NearbyError> {
        Ok(self.lock()?.certificate_fingerprint.clone())
    }

    pub fn preferences(&self) -> Result<NearbyPreferences, NearbyError> {
        Ok(self.lock()?.preferences.clone())
    }

    pub fn update_preferences(
        &self,
        enabled: bool,
        device_name: String,
        download_directory: String,
    ) -> Result<NearbyPreferences, NearbyError> {
        let safe_name = sanitize_device_name(&device_name);
        if safe_name.is_empty() {
            return Err(NearbyError::InvalidInput(
                "기기 이름이 비어 있습니다.".to_owned(),
            ));
        }
        let directory = PathBuf::from(download_directory);
        if !directory.is_absolute() {
            return Err(NearbyError::InvalidInput(
                "다운로드 위치는 절대 경로여야 합니다.".to_owned(),
            ));
        }
        fs::create_dir_all(&directory)?;
        {
            let mut identity = self.lock()?;
            identity.preferences = NearbyPreferences {
                enabled,
                device_name: safe_name,
                download_directory: directory.to_string_lossy().to_string(),
            };
        }
        self.persist()?;
        self.preferences()
    }

    pub fn certificate_der(&self) -> Result<Vec<u8>, NearbyError> {
        BASE64
            .decode(&self.lock()?.certificate_der)
            .map_err(|error| NearbyError::Crypto(error.to_string()))
    }

    fn private_key_der(&self) -> Result<Vec<u8>, NearbyError> {
        BASE64
            .decode(&self.lock()?.private_key_der)
            .map_err(|error| NearbyError::Crypto(error.to_string()))
    }

    pub fn server_config(&self) -> Result<Arc<ServerConfig>, NearbyError> {
        let certificate = CertificateDer::from(self.certificate_der()?);
        let private_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.private_key_der()?));
        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![certificate], private_key)?;
        Ok(Arc::new(config))
    }

    pub fn client_config_for(
        &self,
        certificate_der: Vec<u8>,
    ) -> Result<Arc<ClientConfig>, NearbyError> {
        let mut roots = RootCertStore::empty();
        roots.add(CertificateDer::from(certificate_der))?;
        let config = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        Ok(Arc::new(config))
    }

    pub fn trusted_device(&self, device_id: &str) -> Result<Option<TrustedDevice>, NearbyError> {
        Ok(self
            .lock()?
            .trusted_devices
            .iter()
            .find(|device| device.device_id == device_id)
            .cloned())
    }

    pub fn trusted_devices(&self) -> Result<Vec<TrustedDevice>, NearbyError> {
        Ok(self.lock()?.trusted_devices.clone())
    }

    pub fn trust_device(&self, device: TrustedDevice) -> Result<(), NearbyError> {
        validate_trusted_device(&device)?;
        {
            let mut identity = self.lock()?;
            identity
                .trusted_devices
                .retain(|trusted| trusted.device_id != device.device_id);
            identity.trusted_devices.push(device);
        }
        self.persist()
    }

    pub fn forget_device(&self, device_id: &str) -> Result<(), NearbyError> {
        {
            let mut identity = self.lock()?;
            identity
                .trusted_devices
                .retain(|trusted| trusted.device_id != device_id);
        }
        self.persist()
    }

    pub fn set_auto_accept_files(&self, device_id: &str, enabled: bool) -> Result<(), NearbyError> {
        {
            let mut identity = self.lock()?;
            let trusted = identity
                .trusted_devices
                .iter_mut()
                .find(|device| device.device_id == device_id)
                .ok_or(NearbyError::NotFound)?;
            trusted.auto_accept_files = enabled;
        }
        self.persist()
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, IdentityFile>, NearbyError> {
        self.inner.lock().map_err(|_| NearbyError::StateUnavailable)
    }

    fn persist(&self) -> Result<(), NearbyError> {
        let encoded = serde_json::to_vec_pretty(&*self.lock()?)?;
        let temporary = self.path.with_extension("json.tmp");
        let backup = self.path.with_extension("json.bak");
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&encoded)?;
        file.sync_all()?;
        drop(file);
        if self.path.exists() {
            fs::copy(&self.path, &backup)?;
            set_private_permissions(&backup)?;
        }
        #[cfg(windows)]
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        fs::rename(&temporary, &self.path)?;
        set_private_permissions(&self.path)?;
        Ok(())
    }
}

fn read_identity(path: &Path) -> Result<IdentityFile, NearbyError> {
    let bytes = fs::read(path)?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(NearbyError::Crypto(
            "Nearby identity 파일이 너무 큽니다.".to_owned(),
        ));
    }
    let identity: IdentityFile = serde_json::from_slice(&bytes)?;
    validate_identity(&identity)?;
    Ok(identity)
}

fn set_private_permissions(path: &Path) -> Result<(), NearbyError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; length];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn random_token(length: usize) -> String {
    BASE64.encode(random_bytes(length))
}

pub fn fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn pairing_code(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    let digest = hasher.finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

pub fn authentication_proof(secret: &str, parts: &[&[u8]]) -> Result<String, NearbyError> {
    let secret = BASE64
        .decode(secret)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    let mut mac = HmacSha256::new_from_slice(&secret)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    for part in parts {
        mac.update(&(part.len() as u64).to_be_bytes());
        mac.update(part);
    }
    Ok(BASE64.encode(mac.finalize().into_bytes()))
}

pub fn verify_authentication_proof(
    secret: &str,
    proof: &str,
    parts: &[&[u8]],
) -> Result<bool, NearbyError> {
    let secret = BASE64
        .decode(secret)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    let proof = BASE64
        .decode(proof)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    let mut mac = HmacSha256::new_from_slice(&secret)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    for part in parts {
        mac.update(&(part.len() as u64).to_be_bytes());
        mac.update(part);
    }
    Ok(mac.verify_slice(&proof).is_ok())
}

pub fn validate_shared_secret(secret: &str) -> Result<(), NearbyError> {
    let decoded = BASE64
        .decode(secret)
        .map_err(|_| NearbyError::Authentication)?;
    if decoded.len() != 32 {
        return Err(NearbyError::Authentication);
    }
    Ok(())
}

pub fn sanitize_device_name(value: &str) -> String {
    value
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}'
                )
        })
        .take(64)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn validate_identity(identity: &IdentityFile) -> Result<(), NearbyError> {
    let certificate = BASE64
        .decode(&identity.certificate_der)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    BASE64
        .decode(&identity.private_key_der)
        .map_err(|error| NearbyError::Crypto(error.to_string()))?;
    if !(8..=128).contains(&identity.device_id.len())
        || identity.certificate_fingerprint != fingerprint(&certificate)
        || identity.preferences.device_name.is_empty()
        || sanitize_device_name(&identity.preferences.device_name)
            != identity.preferences.device_name
        || !Path::new(&identity.preferences.download_directory).is_absolute()
        || identity.trusted_devices.len() > MAX_TRUSTED_DEVICES
    {
        return Err(NearbyError::Crypto(
            "Nearby identity 파일이 손상되었습니다.".to_owned(),
        ));
    }
    let mut trusted_ids = HashSet::with_capacity(identity.trusted_devices.len());
    for device in &identity.trusted_devices {
        validate_trusted_device(device)?;
        if !trusted_ids.insert(&device.device_id) {
            return Err(NearbyError::Crypto(
                "Nearby identity 파일에 중복 기기가 있습니다.".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_trusted_device(device: &TrustedDevice) -> Result<(), NearbyError> {
    if !(8..=128).contains(&device.device_id.len())
        || device.device_name.is_empty()
        || sanitize_device_name(&device.device_name) != device.device_name
        || device.certificate_fingerprint.len() != 64
        || !device
            .certificate_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || validate_shared_secret(&device.shared_secret).is_err()
    {
        return Err(NearbyError::Authentication);
    }
    Ok(())
}

fn dirs_download_directory() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return PathBuf::from(profile).join("Downloads");
    }
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join("Downloads");
    }
    std::env::temp_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncReadExt, io::AsyncWriteExt, net::TcpListener, net::TcpStream};
    use tokio_rustls::{TlsAcceptor, TlsConnector};

    #[test]
    fn pairing_codes_are_stable_and_six_digits() {
        let code = pairing_code(&[b"one", b"two"]);
        assert_eq!(code.len(), 6);
        assert_eq!(code, pairing_code(&[b"one", b"two"]));
        assert_ne!(code, pairing_code(&[b"two", b"one"]));
    }

    #[test]
    fn proofs_reject_tampering() {
        let secret = random_token(32);
        let proof = authentication_proof(&secret, &[b"challenge", b"device"]).unwrap();
        assert!(verify_authentication_proof(&secret, &proof, &[b"challenge", b"device"]).unwrap());
        assert!(!verify_authentication_proof(&secret, &proof, &[b"changed", b"device"]).unwrap());
        assert!(validate_shared_secret(&secret).is_ok());
        assert!(validate_shared_secret("").is_err());
    }

    #[test]
    fn device_names_remove_directional_spoofing_controls() {
        assert_eq!(
            sanitize_device_name("Office\u{202e}cod.exe"),
            "Officecod.exe"
        );
    }

    #[test]
    fn identity_and_certificate_are_persistent() {
        let root =
            std::env::temp_dir().join(format!("directdrop-identity-{}", uuid::Uuid::new_v4()));
        let first = IdentityStore::load_or_create(&root).unwrap();
        let device_id = first.device_id().unwrap();
        let certificate_fingerprint = first.fingerprint().unwrap();
        drop(first);

        let reloaded = IdentityStore::load_or_create(&root).unwrap();
        assert_eq!(reloaded.device_id().unwrap(), device_id);
        assert_eq!(reloaded.fingerprint().unwrap(), certificate_fingerprint);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(root.join("identity.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn pinned_self_signed_tls_connects_on_loopback() {
        let root = std::env::temp_dir().join(format!("directdrop-tls-{}", uuid::Uuid::new_v4()));
        let identity = IdentityStore::load_or_create(&root).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let acceptor = TlsAcceptor::from(identity.server_config().unwrap());
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut stream = acceptor.accept(tcp).await.unwrap();
            stream.write_all(b"directdrop").await.unwrap();
            stream.shutdown().await.unwrap();
        });

        let connector = TlsConnector::from(
            identity
                .client_config_for(identity.certificate_der().unwrap())
                .unwrap(),
        );
        let tcp = TcpStream::connect(address).await.unwrap();
        let server_name = rustls::pki_types::ServerName::try_from("directdrop.local").unwrap();
        let mut stream = connector.connect(server_name, tcp).await.unwrap();
        let mut payload = Vec::new();
        stream.read_to_end(&mut payload).await.unwrap();
        assert_eq!(payload, b"directdrop");
        server.await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
