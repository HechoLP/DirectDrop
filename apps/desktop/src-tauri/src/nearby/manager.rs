use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use rustls::pki_types::ServerName;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Notify, Semaphore},
    task::JoinHandle,
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

use super::{
    identity::{
        authentication_proof, now_millis, pairing_code, random_token, sanitize_device_name,
        validate_shared_secret, verify_authentication_proof, IdentityStore, NearbyPreferences,
        TrustedDevice,
    },
    protocol::{
        read_chunk, read_message, write_chunk, write_message, LanFile, WireMessage,
        CERTIFICATE_REQUEST_MAGIC, LAN_PROTOCOL_VERSION, MAX_CHUNK_BYTES,
    },
    storage::{sha256_hex, validate_manifest, LocalSource, ReceiveSession},
    NearbyError,
};

const SERVICE_TYPE: &str = "_directdrop._tcp.local.";
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
const PAIRING_TIMEOUT: Duration = Duration::from_secs(120);
const TRANSFER_DECISION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_CONCURRENT_CONNECTIONS: usize = 16;
const MAX_CONNECTIONS_PER_IP_PER_MINUTE: usize = 60;
const MAX_DISCOVERED_DEVICES: usize = 256;
const MAX_DISCOVERY_SERVICE_NAMES: usize = 512;
const MAX_TRANSFER_HISTORY: usize = 200;
const RESUME_APPROVAL_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_RESUME_APPROVALS: usize = 128;

#[derive(Default)]
struct IpRateLimiter {
    attempts: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl IpRateLimiter {
    fn allow(&self, address: IpAddr, now: Instant) -> bool {
        let Ok(mut attempts) = self.attempts.lock() else {
            return false;
        };
        attempts.retain(|_, entries| {
            entries.retain(|attempt| now.duration_since(*attempt) < Duration::from_secs(60));
            !entries.is_empty()
        });
        let entries = attempts.entry(address).or_default();
        if entries.len() >= MAX_CONNECTIONS_PER_IP_PER_MINUTE {
            return false;
        }
        entries.push_back(now);
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyDevice {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub address: String,
    pub port: u16,
    pub protocol_version: u16,
    pub certificate_fingerprint: String,
    pub paired: bool,
    pub last_seen: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyStatus {
    pub preferences: NearbyPreferences,
    pub devices: Vec<NearbyDevice>,
    pub trusted_devices: Vec<TrustedDeviceSummary>,
    pub listening_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDeviceSummary {
    pub device_id: String,
    pub device_name: String,
    pub certificate_fingerprint: String,
    pub paired_at: u64,
    pub auto_accept_files: bool,
}

impl From<TrustedDevice> for TrustedDeviceSummary {
    fn from(device: TrustedDevice) -> Self {
        Self {
            device_id: device.device_id,
            device_name: device.device_name,
            certificate_fingerprint: device.certificate_fingerprint,
            paired_at: device.paired_at,
            auto_accept_files: device.auto_accept_files,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingTicket {
    pub pairing_id: String,
    pub device_id: String,
    pub device_name: String,
    pub code: String,
    pub incoming: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingResult {
    pairing_id: String,
    device_id: String,
    accepted: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingTransferOffer {
    pub transfer_id: String,
    pub device_id: String,
    pub device_name: String,
    pub files: Vec<LanFile>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyTransferSnapshot {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub direction: String,
    pub files: Vec<LanFile>,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub status: String,
    pub error: Option<String>,
    pub updated_at: u64,
}

#[derive(Clone)]
struct OutboundPlan {
    transfer_id: String,
    device: NearbyDevice,
    sources: Vec<LocalSource>,
    total_bytes: u64,
}

struct ApprovedIncomingTransfer {
    device_id: String,
    files: Vec<LanFile>,
    total_bytes: u64,
    expires_at: Instant,
}

struct RuntimeState {
    daemon: ServiceDaemon,
    listener_task: JoinHandle<()>,
    browser_task: JoinHandle<()>,
    listening_port: u16,
}

struct TransferControl {
    state: AtomicU8,
    changed: Notify,
}

impl TransferControl {
    fn new() -> Self {
        Self {
            state: AtomicU8::new(0),
            changed: Notify::new(),
        }
    }

    fn pause(&self) {
        self.state.store(1, Ordering::Release);
        self.changed.notify_one();
    }

    fn resume(&self) {
        self.state.store(0, Ordering::Release);
        self.changed.notify_one();
    }

    fn cancel(&self) {
        self.state.store(2, Ordering::Release);
        self.changed.notify_one();
    }

    async fn wait_ready(&self) -> Result<(), NearbyError> {
        loop {
            match self.state.load(Ordering::Acquire) {
                0 => return Ok(()),
                1 => self.changed.notified().await,
                _ => return Err(NearbyError::Cancelled),
            }
        }
    }
}

#[derive(Clone)]
pub struct NearbyManager {
    inner: Arc<NearbyInner>,
}

struct NearbyInner {
    app: AppHandle,
    identity: IdentityStore,
    devices: RwLock<HashMap<String, NearbyDevice>>,
    service_names: RwLock<HashMap<String, String>>,
    runtime: Mutex<Option<RuntimeState>>,
    pairing_decisions: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    transfer_decisions: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    controls: Mutex<HashMap<String, Arc<TransferControl>>>,
    transfers: RwLock<HashMap<String, NearbyTransferSnapshot>>,
    history_path: PathBuf,
    outbound_plans: Mutex<HashMap<String, OutboundPlan>>,
    approved_incoming: Mutex<HashMap<String, ApprovedIncomingTransfer>>,
    connection_limit: Arc<Semaphore>,
    connection_rate_limit: IpRateLimiter,
}

impl NearbyManager {
    pub fn new(app: AppHandle, data_directory: PathBuf) -> Result<Self, NearbyError> {
        let nearby_directory = data_directory.join("nearby");
        let identity = IdentityStore::load_or_create(&nearby_directory)?;
        let history_path = nearby_directory.join("transfer-history.json");
        let transfers = load_transfer_history(&history_path)?;
        Ok(Self {
            inner: Arc::new(NearbyInner {
                app,
                identity,
                devices: RwLock::new(HashMap::new()),
                service_names: RwLock::new(HashMap::new()),
                runtime: Mutex::new(None),
                pairing_decisions: Mutex::new(HashMap::new()),
                transfer_decisions: Mutex::new(HashMap::new()),
                controls: Mutex::new(HashMap::new()),
                transfers: RwLock::new(transfers),
                history_path,
                outbound_plans: Mutex::new(HashMap::new()),
                approved_incoming: Mutex::new(HashMap::new()),
                connection_limit: Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS)),
                connection_rate_limit: IpRateLimiter::default(),
            }),
        })
    }

    pub async fn start(&self) -> Result<NearbyStatus, NearbyError> {
        if self.listening_port()?.is_some() {
            return self.status();
        }
        let listener = TcpListener::bind(("0.0.0.0", 0)).await?;
        let port = listener.local_addr()?.port();
        let daemon = ServiceDaemon::new()?;
        let preferences = self.inner.identity.preferences()?;
        let device_id = self.inner.identity.device_id()?;
        let fingerprint = self.inner.identity.fingerprint()?;
        let instance = format!("DirectDrop-{}", &device_id[..8]);
        let hostname = format!("directdrop-{}.local.", &device_id[..8]);
        let properties = [
            ("id", device_id.as_str()),
            ("name", preferences.device_name.as_str()),
            ("platform", std::env::consts::OS),
            ("version", "1"),
            ("fingerprint", fingerprint.as_str()),
            ("capabilities", "files,multi,resume,pause,tls"),
        ];
        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &instance,
            &hostname,
            "",
            port,
            &properties[..],
        )?
        .enable_addr_auto();
        daemon.register(service)?;
        let events = daemon.browse(SERVICE_TYPE)?;

        let listener_manager = self.clone();
        let listener_task = tokio::spawn(async move {
            loop {
                let Ok((stream, peer)) = listener.accept().await else {
                    break;
                };
                if !is_local_address(peer.ip())
                    || !listener_manager
                        .inner
                        .connection_rate_limit
                        .allow(peer.ip(), Instant::now())
                {
                    continue;
                }
                let manager = listener_manager.clone();
                let permit = manager.inner.connection_limit.clone().acquire_owned().await;
                let Ok(permit) = permit else { break };
                tokio::spawn(async move {
                    let _permit = permit;
                    if let Err(error) = manager.handle_incoming(stream, peer).await {
                        if !matches!(error, NearbyError::Cancelled) {
                            eprintln!("DirectDrop Nearby connection failed: {error}");
                        }
                    }
                });
            }
        });
        let browser_manager = self.clone();
        let browser_task = tokio::spawn(async move {
            while let Ok(event) = events.recv_async().await {
                browser_manager.handle_discovery_event(event);
            }
        });

        let mut runtime = self
            .inner
            .runtime
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?;
        if runtime.is_some() {
            listener_task.abort();
            browser_task.abort();
            let _ = daemon.shutdown();
        } else {
            *runtime = Some(RuntimeState {
                daemon,
                listener_task,
                browser_task,
                listening_port: port,
            });
        }
        drop(runtime);
        self.status()
    }

    pub fn stop(&self) -> Result<NearbyStatus, NearbyError> {
        let runtime = self
            .inner
            .runtime
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .take();
        if let Some(runtime) = runtime {
            runtime.listener_task.abort();
            runtime.browser_task.abort();
            let _ = runtime.daemon.stop_browse(SERVICE_TYPE);
            let _ = runtime.daemon.shutdown();
        }
        self.inner
            .devices
            .write()
            .map_err(|_| NearbyError::StateUnavailable)?
            .clear();
        self.inner
            .service_names
            .write()
            .map_err(|_| NearbyError::StateUnavailable)?
            .clear();
        self.emit_devices();
        self.status()
    }

    pub async fn update_preferences(
        &self,
        enabled: bool,
        device_name: String,
        download_directory: String,
    ) -> Result<NearbyStatus, NearbyError> {
        let previous = self.inner.identity.preferences()?;
        self.inner
            .identity
            .update_preferences(enabled, device_name, download_directory)?;
        if !enabled {
            self.stop()?;
        } else if !previous.enabled || self.listening_port()?.is_none() {
            self.start().await?;
        } else if previous.device_name != self.inner.identity.preferences()?.device_name {
            self.stop()?;
            self.start().await?;
        }
        self.status()
    }

    pub fn status(&self) -> Result<NearbyStatus, NearbyError> {
        let mut devices = self
            .inner
            .devices
            .read()
            .map_err(|_| NearbyError::StateUnavailable)?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        devices.sort_by(|left, right| left.device_name.cmp(&right.device_name));
        Ok(NearbyStatus {
            preferences: self.inner.identity.preferences()?,
            devices,
            trusted_devices: self
                .inner
                .identity
                .trusted_devices()?
                .into_iter()
                .map(TrustedDeviceSummary::from)
                .collect(),
            listening_port: self.listening_port()?,
        })
    }

    pub fn transfers(&self) -> Result<Vec<NearbyTransferSnapshot>, NearbyError> {
        let mut transfers = self
            .inner
            .transfers
            .read()
            .map_err(|_| NearbyError::StateUnavailable)?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        transfers.sort_by_key(|transfer| std::cmp::Reverse(transfer.updated_at));
        Ok(transfers)
    }

    pub async fn begin_pairing(&self, device_id: &str) -> Result<PairingTicket, NearbyError> {
        if self.inner.identity.trusted_device(device_id)?.is_some() {
            return Err(NearbyError::InvalidInput(
                "이미 신뢰하는 기기입니다.".to_owned(),
            ));
        }
        let device = self.device(device_id)?;
        let (mut stream, challenge) = self.connect_tls(&device).await?;
        let (server_nonce, server_device_id, server_device_name, server_fingerprint) =
            parse_challenge(challenge, &device)?;
        let client_nonce = random_token(32);
        write_message(
            &mut stream,
            &WireMessage::Authenticate {
                protocol_version: LAN_PROTOCOL_VERSION,
                device_id: self.inner.identity.device_id()?,
                device_name: self.inner.identity.preferences()?.device_name,
                certificate_fingerprint: self.inner.identity.fingerprint()?,
                expected_server_fingerprint: server_fingerprint.clone(),
                client_nonce: client_nonce.clone(),
                proof: None,
            },
        )
        .await?;
        let (pairing_id, code) =
            match timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await?? {
                WireMessage::PairingRequired { pairing_id, code } => (pairing_id, code),
                WireMessage::Error { message, .. } => return Err(NearbyError::Protocol(message)),
                _ => {
                    return Err(NearbyError::Protocol(
                        "pairing response expected".to_owned(),
                    ))
                }
            };
        let expected_code = pairing_code(&[
            client_nonce.as_bytes(),
            server_nonce.as_bytes(),
            self.inner.identity.device_id()?.as_bytes(),
            server_device_id.as_bytes(),
            server_fingerprint.as_bytes(),
        ]);
        if code != expected_code {
            return Err(NearbyError::Authentication);
        }
        let ticket = PairingTicket {
            pairing_id: pairing_id.clone(),
            device_id: server_device_id.clone(),
            device_name: server_device_name.clone(),
            code,
            incoming: false,
        };
        let (decision_sender, decision_receiver) = oneshot::channel();
        self.insert_pairing_decision(pairing_id.clone(), decision_sender)?;
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = manager
                .finish_outgoing_pairing(stream, pairing_id.clone(), device, decision_receiver)
                .await;
            manager.remove_pairing_decision(&pairing_id);
            manager.emit_pairing_result(&pairing_id, &server_device_id, &result);
        });
        Ok(ticket)
    }

    pub fn decide_pairing(&self, pairing_id: &str, accepted: bool) -> Result<(), NearbyError> {
        let sender = self
            .inner
            .pairing_decisions
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .remove(pairing_id)
            .ok_or(NearbyError::NotFound)?;
        sender.send(accepted).map_err(|_| NearbyError::NotFound)
    }

    pub fn forget_device(&self, device_id: &str) -> Result<NearbyStatus, NearbyError> {
        self.inner.identity.forget_device(device_id)?;
        if let Ok(mut devices) = self.inner.devices.write() {
            if let Some(device) = devices.get_mut(device_id) {
                device.paired = false;
            }
        }
        self.emit_devices();
        self.status()
    }

    pub fn set_auto_accept_files(
        &self,
        device_id: &str,
        enabled: bool,
    ) -> Result<NearbyStatus, NearbyError> {
        self.inner
            .identity
            .set_auto_accept_files(device_id, enabled)?;
        self.status()
    }

    pub fn send_files(
        &self,
        device_id: &str,
        sources: Vec<LocalSource>,
    ) -> Result<String, NearbyError> {
        let device = self.device(device_id)?;
        let trusted = self
            .inner
            .identity
            .trusted_device(device_id)?
            .ok_or(NearbyError::PairingRequired)?;
        if trusted.certificate_fingerprint != device.certificate_fingerprint {
            return Err(NearbyError::Authentication);
        }
        let files = sources
            .iter()
            .map(|source| source.file.clone())
            .collect::<Vec<_>>();
        let total_bytes = validate_manifest(&files)?;
        let transfer_id = uuid::Uuid::new_v4().to_string();
        let plan = OutboundPlan {
            transfer_id: transfer_id.clone(),
            device: device.clone(),
            sources,
            total_bytes,
        };
        self.inner
            .outbound_plans
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .insert(transfer_id.clone(), plan.clone());
        self.spawn_outbound(plan)?;
        Ok(transfer_id)
    }

    pub fn retry_transfer(&self, transfer_id: &str) -> Result<(), NearbyError> {
        let plan = self
            .inner
            .outbound_plans
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .get(transfer_id)
            .cloned()
            .ok_or(NearbyError::NotFound)?;
        if self
            .inner
            .transfers
            .read()
            .map_err(|_| NearbyError::StateUnavailable)?
            .get(transfer_id)
            .is_some_and(|snapshot| {
                matches!(
                    snapshot.status.as_str(),
                    "CONNECTING" | "TRANSFERRING" | "PAUSED"
                )
            })
        {
            return Err(NearbyError::InvalidInput("이미 전송 중입니다.".to_owned()));
        }
        self.spawn_outbound(plan)
    }

    pub fn decide_transfer(&self, transfer_id: &str, accepted: bool) -> Result<(), NearbyError> {
        let sender = self
            .inner
            .transfer_decisions
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .remove(transfer_id)
            .ok_or(NearbyError::NotFound)?;
        sender.send(accepted).map_err(|_| NearbyError::NotFound)
    }

    pub fn pause_transfer(&self, transfer_id: &str) -> Result<(), NearbyError> {
        let direction = self
            .inner
            .transfers
            .read()
            .map_err(|_| NearbyError::StateUnavailable)?
            .get(transfer_id)
            .map(|snapshot| snapshot.direction.clone())
            .ok_or(NearbyError::NotFound)?;
        if direction != "SEND" {
            return Err(NearbyError::InvalidInput(
                "수신 전송은 보낸 기기에서 일시정지할 수 있습니다.".to_owned(),
            ));
        }
        let control = self.control(transfer_id)?;
        control.pause();
        self.set_transfer_status(transfer_id, "PAUSED", None);
        Ok(())
    }

    pub fn resume_transfer(&self, transfer_id: &str) -> Result<(), NearbyError> {
        let direction = self
            .inner
            .transfers
            .read()
            .map_err(|_| NearbyError::StateUnavailable)?
            .get(transfer_id)
            .map(|snapshot| snapshot.direction.clone())
            .ok_or(NearbyError::NotFound)?;
        if direction != "SEND" {
            return Err(NearbyError::InvalidInput(
                "수신 전송은 보낸 기기에서 재개할 수 있습니다.".to_owned(),
            ));
        }
        let control = self.control(transfer_id)?;
        control.resume();
        self.set_transfer_status(transfer_id, "TRANSFERRING", None);
        Ok(())
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> Result<(), NearbyError> {
        let control = self.control(transfer_id)?;
        control.cancel();
        self.set_transfer_status(transfer_id, "CANCELLED", None);
        self.inner
            .outbound_plans
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .remove(transfer_id);
        Ok(())
    }

    fn spawn_outbound(&self, plan: OutboundPlan) -> Result<(), NearbyError> {
        let control = Arc::new(TransferControl::new());
        self.inner
            .controls
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .insert(plan.transfer_id.clone(), control.clone());
        self.upsert_snapshot(NearbyTransferSnapshot {
            id: plan.transfer_id.clone(),
            device_id: plan.device.device_id.clone(),
            device_name: plan.device.device_name.clone(),
            direction: "SEND".to_owned(),
            files: plan
                .sources
                .iter()
                .map(|source| source.file.clone())
                .collect(),
            total_bytes: plan.total_bytes,
            transferred_bytes: 0,
            bytes_per_second: 0,
            eta_seconds: None,
            status: "CONNECTING".to_owned(),
            error: None,
            updated_at: now_millis(),
        });
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let transfer_id = plan.transfer_id.clone();
            let mut attempt = 0_u32;
            let result = loop {
                if let Err(control_error) = control.wait_ready().await {
                    break Err(control_error);
                }
                let result = manager.run_outbound(plan.clone(), control.clone()).await;
                match result {
                    Err(error) if is_retryable_connection_error(&error) && attempt < 3 => {
                        attempt += 1;
                        manager.set_transfer_status(&transfer_id, "CONNECTING", None);
                        if let Err(control_error) = control.wait_ready().await {
                            break Err(control_error);
                        }
                        tokio::time::sleep(Duration::from_secs(1 << (attempt - 1))).await;
                    }
                    terminal => break terminal,
                }
            };
            if let Err(error) = result {
                let status = if matches!(error, NearbyError::Cancelled) {
                    "CANCELLED"
                } else {
                    "FAILED"
                };
                manager.set_transfer_status(&transfer_id, status, Some(error.to_string()));
            }
            if let Ok(mut controls) = manager.inner.controls.lock() {
                controls.remove(&transfer_id);
            }
        });
        Ok(())
    }

    async fn run_outbound(
        &self,
        plan: OutboundPlan,
        control: Arc<TransferControl>,
    ) -> Result<(), NearbyError> {
        let (mut stream, _) = self.connect_authenticated(&plan.device).await?;
        let files = plan
            .sources
            .iter()
            .map(|source| source.file.clone())
            .collect();
        write_message(
            &mut stream,
            &WireMessage::TransferOffer {
                transfer_id: plan.transfer_id.clone(),
                files,
                total_bytes: plan.total_bytes,
            },
        )
        .await?;
        let decision = read_message_controlled(
            &mut stream,
            &control,
            &plan.transfer_id,
            TRANSFER_DECISION_TIMEOUT,
        )
        .await?;
        let offsets = match decision {
            WireMessage::TransferDecision {
                transfer_id,
                accepted: true,
                offsets,
            } if transfer_id == plan.transfer_id => offsets,
            WireMessage::TransferDecision {
                accepted: false, ..
            } => return Err(NearbyError::Rejected),
            WireMessage::Error { message, .. } => return Err(NearbyError::Protocol(message)),
            _ => {
                return Err(NearbyError::Protocol(
                    "transfer decision expected".to_owned(),
                ))
            }
        };
        let offset_map = offsets
            .into_iter()
            .map(|offset| (offset.file_id, offset.offset))
            .collect::<HashMap<_, _>>();
        if offset_map.len() != plan.sources.len() {
            return Err(NearbyError::Protocol("invalid resume offsets".to_owned()));
        }
        let mut transferred = 0_u64;
        for source in &plan.sources {
            let offset = *offset_map
                .get(&source.file.id)
                .ok_or_else(|| NearbyError::Protocol("missing resume offset".to_owned()))?;
            if offset > source.file.size {
                return Err(NearbyError::Protocol(
                    "resume offset exceeds file".to_owned(),
                ));
            }
            transferred = transferred
                .checked_add(offset)
                .ok_or_else(|| NearbyError::Protocol("resume total overflow".to_owned()))?;
        }
        let transferred_before = transferred;
        self.set_transfer_progress(&plan.transfer_id, transferred, 0);
        self.set_transfer_status(&plan.transfer_id, "TRANSFERRING", None);
        let started = Instant::now();
        for source in &plan.sources {
            validate_source(source).await?;
            let mut file = File::open(&source.path).await?;
            let mut offset = offset_map[&source.file.id];
            file.seek(SeekFrom::Start(offset)).await?;
            while offset < source.file.size {
                control.wait_ready().await?;
                let length = MAX_CHUNK_BYTES.min((source.file.size - offset) as usize);
                let mut bytes = vec![0_u8; length];
                file.read_exact(&mut bytes).await?;
                validate_source(source).await?;
                write_chunk(
                    &mut stream,
                    WireMessage::Chunk {
                        transfer_id: plan.transfer_id.clone(),
                        file_id: source.file.id.clone(),
                        offset,
                        length: bytes.len() as u32,
                        sha256: sha256_hex(&bytes),
                    },
                    &bytes,
                )
                .await?;
                match read_message_controlled(
                    &mut stream,
                    &control,
                    &plan.transfer_id,
                    CONNECTION_TIMEOUT,
                )
                .await?
                {
                    WireMessage::Ack {
                        transfer_id,
                        file_id,
                        received_offset,
                    } if transfer_id == plan.transfer_id
                        && file_id == source.file.id
                        && received_offset == offset + bytes.len() as u64 => {}
                    WireMessage::Cancel { .. } => return Err(NearbyError::Cancelled),
                    WireMessage::Error { message, .. } => {
                        return Err(NearbyError::Protocol(message))
                    }
                    _ => {
                        return Err(NearbyError::Protocol(
                            "invalid chunk acknowledgement".to_owned(),
                        ))
                    }
                }
                offset += bytes.len() as u64;
                transferred += bytes.len() as u64;
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                self.set_transfer_progress(
                    &plan.transfer_id,
                    transferred,
                    ((transferred - transferred_before) as f64 / elapsed) as u64,
                );
            }
            validate_source(source).await?;
        }
        write_message(
            &mut stream,
            &WireMessage::Complete {
                transfer_id: plan.transfer_id.clone(),
            },
        )
        .await?;
        match read_message_controlled(&mut stream, &control, &plan.transfer_id, CONNECTION_TIMEOUT)
            .await?
        {
            WireMessage::CompleteAck { transfer_id } if transfer_id == plan.transfer_id => {}
            _ => {
                return Err(NearbyError::Protocol(
                    "completion acknowledgement expected".to_owned(),
                ))
            }
        }
        self.set_transfer_progress(&plan.transfer_id, plan.total_bytes, 0);
        self.set_transfer_status(&plan.transfer_id, "COMPLETED", None);
        self.inner
            .outbound_plans
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .remove(&plan.transfer_id);
        Ok(())
    }

    async fn handle_incoming(
        &self,
        mut stream: TcpStream,
        peer: SocketAddr,
    ) -> Result<(), NearbyError> {
        let mut prefix = [0_u8; 8];
        let read = timeout(CONNECTION_TIMEOUT, stream.peek(&mut prefix)).await??;
        if read == CERTIFICATE_REQUEST_MAGIC.len() && &prefix == CERTIFICATE_REQUEST_MAGIC {
            stream.read_exact(&mut prefix).await?;
            let certificate = self.inner.identity.certificate_der()?;
            if certificate.len() > 64 * 1024 {
                return Err(NearbyError::Crypto("certificate is too large".to_owned()));
            }
            stream.write_u32(certificate.len() as u32).await?;
            stream.write_all(&certificate).await?;
            stream.shutdown().await?;
            return Ok(());
        }
        let acceptor = TlsAcceptor::from(self.inner.identity.server_config()?);
        let mut stream = timeout(CONNECTION_TIMEOUT, acceptor.accept(stream)).await??;
        let server_nonce = random_token(32);
        let server_device_id = self.inner.identity.device_id()?;
        let server_device_name = self.inner.identity.preferences()?.device_name;
        let server_fingerprint = self.inner.identity.fingerprint()?;
        write_message(
            &mut stream,
            &WireMessage::Challenge {
                protocol_version: LAN_PROTOCOL_VERSION,
                server_nonce: server_nonce.clone(),
                server_device_id: server_device_id.clone(),
                server_device_name,
                certificate_fingerprint: server_fingerprint.clone(),
            },
        )
        .await?;
        let auth = timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await??;
        let WireMessage::Authenticate {
            protocol_version,
            device_id,
            device_name,
            certificate_fingerprint,
            expected_server_fingerprint,
            client_nonce,
            proof,
        } = auth
        else {
            return Err(NearbyError::Authentication);
        };
        validate_auth_fields(
            protocol_version,
            &device_id,
            &device_name,
            &certificate_fingerprint,
            &expected_server_fingerprint,
            &client_nonce,
        )?;
        if expected_server_fingerprint != server_fingerprint {
            return Err(NearbyError::Authentication);
        }
        if let Some(trusted) = self.inner.identity.trusted_device(&device_id)? {
            if !trusted
                .certificate_fingerprint
                .eq_ignore_ascii_case(&certificate_fingerprint)
            {
                return Err(NearbyError::Authentication);
            }
            let proof = proof.ok_or(NearbyError::Authentication)?;
            let parts = auth_parts(
                b"client-auth-v1",
                &server_nonce,
                &client_nonce,
                &device_id,
                &server_device_id,
                &certificate_fingerprint,
                &server_fingerprint,
            );
            if !verify_authentication_proof(&trusted.shared_secret, &proof, &parts)? {
                return Err(NearbyError::Authentication);
            }
            let response_parts = auth_parts(
                b"server-auth-v1",
                &server_nonce,
                &client_nonce,
                &device_id,
                &server_device_id,
                &certificate_fingerprint,
                &server_fingerprint,
            );
            write_message(
                &mut stream,
                &WireMessage::Authenticated {
                    proof: authentication_proof(&trusted.shared_secret, &response_parts)?,
                },
            )
            .await?;
            self.receive_transfer(stream, trusted).await
        } else {
            if proof.is_some() {
                return Err(NearbyError::Authentication);
            }
            self.handle_incoming_pairing(
                stream,
                peer,
                device_id,
                device_name,
                certificate_fingerprint,
                client_nonce,
                server_nonce,
                server_device_id,
                server_fingerprint,
            )
            .await
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_incoming_pairing<S>(
        &self,
        mut stream: S,
        _peer: SocketAddr,
        device_id: String,
        device_name: String,
        client_fingerprint: String,
        client_nonce: String,
        server_nonce: String,
        server_device_id: String,
        server_fingerprint: String,
    ) -> Result<(), NearbyError>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let pairing_id = uuid::Uuid::new_v4().to_string();
        let code = pairing_code(&[
            client_nonce.as_bytes(),
            server_nonce.as_bytes(),
            device_id.as_bytes(),
            server_device_id.as_bytes(),
            server_fingerprint.as_bytes(),
        ]);
        write_message(
            &mut stream,
            &WireMessage::PairingRequired {
                pairing_id: pairing_id.clone(),
                code: code.clone(),
            },
        )
        .await?;
        let ticket = PairingTicket {
            pairing_id: pairing_id.clone(),
            device_id: device_id.clone(),
            device_name: device_name.clone(),
            code,
            incoming: true,
        };
        let (decision_sender, decision_receiver) = oneshot::channel();
        self.insert_pairing_decision(pairing_id.clone(), decision_sender)?;
        let _ = self.inner.app.emit("nearby-pairing-request", ticket);
        let result = async {
            let decision = match timeout(PAIRING_TIMEOUT, decision_receiver).await {
                Ok(result) => result.map_err(|_| NearbyError::Cancelled),
                Err(_) => Err(NearbyError::Timeout),
            };
            let local_accepted = decision?;
            write_message(
                &mut stream,
                &WireMessage::PairingDecision {
                    pairing_id: pairing_id.clone(),
                    accepted: local_accepted,
                },
            )
            .await?;
            let remote_accepted =
                match timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await?? {
                    WireMessage::PairingDecision {
                        pairing_id: remote_id,
                        accepted,
                    } if remote_id == pairing_id => accepted,
                    _ => false,
                };
            if !local_accepted || !remote_accepted {
                return Err(NearbyError::Rejected);
            }
            let shared_secret = random_token(32);
            write_message(
                &mut stream,
                &WireMessage::PairingSecret {
                    pairing_id: pairing_id.clone(),
                    shared_secret: shared_secret.clone(),
                },
            )
            .await?;
            match timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await?? {
                WireMessage::PairingComplete {
                    pairing_id: remote_id,
                } if remote_id == pairing_id => {}
                _ => return Err(NearbyError::Authentication),
            }
            self.inner.identity.trust_device(TrustedDevice {
                device_id: device_id.clone(),
                device_name,
                certificate_fingerprint: client_fingerprint,
                shared_secret,
                paired_at: now_millis(),
                auto_accept_files: false,
            })?;
            self.refresh_pair_state(&device_id);
            Ok(())
        }
        .await;
        self.remove_pairing_decision(&pairing_id);
        self.emit_pairing_result(&pairing_id, &device_id, &result);
        result
    }

    async fn finish_outgoing_pairing<S>(
        &self,
        mut stream: S,
        pairing_id: String,
        device: NearbyDevice,
        decision_receiver: oneshot::Receiver<bool>,
    ) -> Result<(), NearbyError>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let local_accepted = timeout(PAIRING_TIMEOUT, decision_receiver)
            .await
            .map_err(|_| NearbyError::Timeout)?
            .map_err(|_| NearbyError::Cancelled)?;
        write_message(
            &mut stream,
            &WireMessage::PairingDecision {
                pairing_id: pairing_id.clone(),
                accepted: local_accepted,
            },
        )
        .await?;
        let remote_accepted = match timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await?? {
            WireMessage::PairingDecision {
                pairing_id: remote_id,
                accepted,
            } if remote_id == pairing_id => accepted,
            _ => false,
        };
        if !local_accepted || !remote_accepted {
            return Err(NearbyError::Rejected);
        }
        let shared_secret = match timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await?? {
            WireMessage::PairingSecret {
                pairing_id: remote_id,
                shared_secret,
            } if remote_id == pairing_id => shared_secret,
            _ => return Err(NearbyError::Authentication),
        };
        validate_shared_secret(&shared_secret)?;
        self.inner.identity.trust_device(TrustedDevice {
            device_id: device.device_id.clone(),
            device_name: device.device_name.clone(),
            certificate_fingerprint: device.certificate_fingerprint.clone(),
            shared_secret,
            paired_at: now_millis(),
            auto_accept_files: false,
        })?;
        write_message(
            &mut stream,
            &WireMessage::PairingComplete {
                pairing_id: pairing_id.clone(),
            },
        )
        .await?;
        self.refresh_pair_state(&device.device_id);
        Ok(())
    }

    async fn receive_transfer<S>(
        &self,
        mut stream: S,
        trusted: TrustedDevice,
    ) -> Result<(), NearbyError>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let offer = timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await??;
        let WireMessage::TransferOffer {
            transfer_id,
            files,
            total_bytes,
        } = offer
        else {
            return Err(NearbyError::Protocol("transfer offer expected".to_owned()));
        };
        if validate_manifest(&files)? != total_bytes {
            return Err(NearbyError::Protocol("transfer total mismatch".to_owned()));
        }
        self.upsert_snapshot(NearbyTransferSnapshot {
            id: transfer_id.clone(),
            device_id: trusted.device_id.clone(),
            device_name: trusted.device_name.clone(),
            direction: "RECEIVE".to_owned(),
            files: files.clone(),
            total_bytes,
            transferred_bytes: 0,
            bytes_per_second: 0,
            eta_seconds: None,
            status: "WAITING".to_owned(),
            error: None,
            updated_at: now_millis(),
        });
        let resume_approved =
            self.has_resume_approval(&transfer_id, &trusted.device_id, &files, total_bytes)?;
        let accepted = if trusted.auto_accept_files || resume_approved {
            true
        } else {
            let (sender, receiver) = oneshot::channel();
            self.inner
                .transfer_decisions
                .lock()
                .map_err(|_| NearbyError::StateUnavailable)?
                .insert(transfer_id.clone(), sender);
            let _ = self.inner.app.emit(
                "nearby-transfer-offer",
                IncomingTransferOffer {
                    transfer_id: transfer_id.clone(),
                    device_id: trusted.device_id.clone(),
                    device_name: trusted.device_name.clone(),
                    files: files.clone(),
                    total_bytes,
                },
            );
            let decision = match timeout(TRANSFER_DECISION_TIMEOUT, receiver).await {
                Ok(result) => result.map_err(|_| NearbyError::Cancelled),
                Err(_) => Err(NearbyError::Timeout),
            };
            if let Ok(mut decisions) = self.inner.transfer_decisions.lock() {
                decisions.remove(&transfer_id);
            }
            match decision {
                Ok(accepted) => accepted,
                Err(error) => {
                    self.set_transfer_status(&transfer_id, "FAILED", Some(error.to_string()));
                    self.clear_incoming_approval(&transfer_id);
                    return Err(error);
                }
            }
        };
        if !accepted {
            self.set_transfer_status(&transfer_id, "CANCELLED", None);
            let result = write_message(
                &mut stream,
                &WireMessage::TransferDecision {
                    transfer_id: transfer_id.clone(),
                    accepted: false,
                    offsets: Vec::new(),
                },
            )
            .await;
            self.clear_incoming_approval(&transfer_id);
            return result;
        }
        self.remember_incoming_approval(&transfer_id, &trusted.device_id, &files, total_bytes)?;
        let download_directory =
            PathBuf::from(self.inner.identity.preferences()?.download_directory);
        let (mut session, offsets) =
            match ReceiveSession::prepare(download_directory, &transfer_id, &files).await {
                Ok(prepared) => prepared,
                Err(error) => {
                    self.set_transfer_status(&transfer_id, "FAILED", Some(error.to_string()));
                    self.clear_incoming_approval(&transfer_id);
                    return Err(error);
                }
            };
        let transferred_before = session.transferred_bytes();
        if let Err(error) = write_message(
            &mut stream,
            &WireMessage::TransferDecision {
                transfer_id: transfer_id.clone(),
                accepted: true,
                offsets,
            },
        )
        .await
        {
            self.set_transfer_status(&transfer_id, "FAILED", Some(error.to_string()));
            if !is_retryable_connection_error(&error) {
                self.clear_incoming_approval(&transfer_id);
            }
            return Err(error);
        }
        let control = Arc::new(TransferControl::new());
        let insert_control = self
            .inner
            .controls
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)
            .map(|mut controls| {
                controls.insert(transfer_id.clone(), control.clone());
            });
        if let Err(error) = insert_control {
            self.set_transfer_status(&transfer_id, "FAILED", Some(error.to_string()));
            self.clear_incoming_approval(&transfer_id);
            return Err(error);
        }
        self.set_transfer_status(&transfer_id, "TRANSFERRING", None);
        self.set_transfer_progress(&transfer_id, transferred_before, 0);
        let started = Instant::now();
        let result: Result<(), NearbyError> = async {
            loop {
                if let Err(error) = control.wait_ready().await {
                    let _ = write_message(
                        &mut stream,
                        &WireMessage::Cancel {
                            transfer_id: transfer_id.clone(),
                        },
                    )
                    .await;
                    session.cancel().await?;
                    return Err(error);
                }
                let message = tokio::select! {
                    message = read_message(&mut stream) => message?,
                    _ = control.changed.notified() => continue,
                };
                match message {
                    WireMessage::Chunk {
                        transfer_id: incoming_id,
                        file_id,
                        offset,
                        length,
                        sha256,
                    } if incoming_id == transfer_id => {
                        let bytes = read_chunk(&mut stream, length as usize).await?;
                        let received_offset = session
                            .write_chunk(&file_id, offset, &sha256, &bytes)
                            .await?;
                        write_message(
                            &mut stream,
                            &WireMessage::Ack {
                                transfer_id: transfer_id.clone(),
                                file_id,
                                received_offset,
                            },
                        )
                        .await?;
                        let transferred = session.transferred_bytes();
                        let elapsed = started.elapsed().as_secs_f64().max(0.001);
                        self.set_transfer_progress(
                            &transfer_id,
                            transferred,
                            ((transferred - transferred_before) as f64 / elapsed) as u64,
                        );
                    }
                    WireMessage::Complete {
                        transfer_id: incoming_id,
                    } if incoming_id == transfer_id => {
                        let _destinations = session.complete().await?;
                        write_message(
                            &mut stream,
                            &WireMessage::CompleteAck {
                                transfer_id: transfer_id.clone(),
                            },
                        )
                        .await?;
                        self.set_transfer_progress(&transfer_id, total_bytes, 0);
                        self.set_transfer_status(&transfer_id, "COMPLETED", None);
                        break Ok(());
                    }
                    WireMessage::Cancel {
                        transfer_id: incoming_id,
                    } if incoming_id == transfer_id => {
                        session.cancel().await?;
                        self.set_transfer_status(&transfer_id, "CANCELLED", None);
                        break Ok(());
                    }
                    _ => {
                        break Err(NearbyError::Protocol(
                            "unexpected transfer message".to_owned(),
                        ));
                    }
                }
            }
        }
        .await;
        if let Ok(mut controls) = self.inner.controls.lock() {
            controls.remove(&transfer_id);
        }
        if let Err(error) = &result {
            let status = if matches!(error, NearbyError::Cancelled) {
                "CANCELLED"
            } else {
                "FAILED"
            };
            self.set_transfer_status(&transfer_id, status, Some(error.to_string()));
        }
        if result.is_ok()
            || result
                .as_ref()
                .err()
                .is_some_and(|error| !is_retryable_connection_error(error))
        {
            self.clear_incoming_approval(&transfer_id);
        }
        result
    }

    async fn connect_authenticated(
        &self,
        device: &NearbyDevice,
    ) -> Result<(tokio_rustls::client::TlsStream<TcpStream>, TrustedDevice), NearbyError> {
        let trusted = self
            .inner
            .identity
            .trusted_device(&device.device_id)?
            .ok_or(NearbyError::PairingRequired)?;
        if trusted.certificate_fingerprint != device.certificate_fingerprint {
            return Err(NearbyError::Authentication);
        }
        let (mut stream, challenge) = self.connect_tls(device).await?;
        let (server_nonce, server_device_id, _server_name, server_fingerprint) =
            parse_challenge(challenge, device)?;
        let client_nonce = random_token(32);
        let client_id = self.inner.identity.device_id()?;
        let client_name = self.inner.identity.preferences()?.device_name;
        let client_fingerprint = self.inner.identity.fingerprint()?;
        let parts = auth_parts(
            b"client-auth-v1",
            &server_nonce,
            &client_nonce,
            &client_id,
            &server_device_id,
            &client_fingerprint,
            &server_fingerprint,
        );
        write_message(
            &mut stream,
            &WireMessage::Authenticate {
                protocol_version: LAN_PROTOCOL_VERSION,
                device_id: client_id.clone(),
                device_name: client_name,
                certificate_fingerprint: client_fingerprint.clone(),
                expected_server_fingerprint: server_fingerprint.clone(),
                client_nonce: client_nonce.clone(),
                proof: Some(authentication_proof(&trusted.shared_secret, &parts)?),
            },
        )
        .await?;
        let proof = match timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await?? {
            WireMessage::Authenticated { proof } => proof,
            WireMessage::Error { message, .. } => return Err(NearbyError::Protocol(message)),
            _ => return Err(NearbyError::Authentication),
        };
        let response_parts = auth_parts(
            b"server-auth-v1",
            &server_nonce,
            &client_nonce,
            &client_id,
            &server_device_id,
            &client_fingerprint,
            &server_fingerprint,
        );
        if !verify_authentication_proof(&trusted.shared_secret, &proof, &response_parts)? {
            return Err(NearbyError::Authentication);
        }
        Ok((stream, trusted))
    }

    async fn connect_tls(
        &self,
        device: &NearbyDevice,
    ) -> Result<(tokio_rustls::client::TlsStream<TcpStream>, WireMessage), NearbyError> {
        if device.protocol_version != LAN_PROTOCOL_VERSION {
            return Err(NearbyError::ProtocolVersion);
        }
        let address = format!("{}:{}", device.address, device.port);
        let mut certificate_stream =
            timeout(CONNECTION_TIMEOUT, TcpStream::connect(&address)).await??;
        certificate_stream
            .write_all(CERTIFICATE_REQUEST_MAGIC)
            .await?;
        let certificate_length =
            timeout(CONNECTION_TIMEOUT, certificate_stream.read_u32()).await?? as usize;
        if certificate_length == 0 || certificate_length > 64 * 1024 {
            return Err(NearbyError::Authentication);
        }
        let mut certificate = vec![0_u8; certificate_length];
        timeout(
            CONNECTION_TIMEOUT,
            certificate_stream.read_exact(&mut certificate),
        )
        .await??;
        if super::identity::fingerprint(&certificate) != device.certificate_fingerprint {
            return Err(NearbyError::Authentication);
        }
        let connector = TlsConnector::from(self.inner.identity.client_config_for(certificate)?);
        let tcp = timeout(CONNECTION_TIMEOUT, TcpStream::connect(&address)).await??;
        let server_name = ServerName::try_from("directdrop.local")
            .map_err(|error| NearbyError::Crypto(error.to_string()))?;
        let mut stream = timeout(CONNECTION_TIMEOUT, connector.connect(server_name, tcp)).await??;
        let challenge = timeout(CONNECTION_TIMEOUT, read_message(&mut stream)).await??;
        Ok((stream, challenge))
    }

    fn handle_discovery_event(&self, event: ServiceEvent) {
        match event {
            ServiceEvent::ServiceResolved(info) => {
                let Some(device_id) = info.get_property_val_str("id") else {
                    return;
                };
                if device_id == self.inner.identity.device_id().unwrap_or_default() {
                    return;
                }
                let Some(name) = info.get_property_val_str("name") else {
                    return;
                };
                let Some(fingerprint) = info.get_property_val_str("fingerprint") else {
                    return;
                };
                let version = info
                    .get_property_val_str("version")
                    .and_then(|value| value.parse::<u16>().ok())
                    .unwrap_or(0);
                let mut addresses = info.get_addresses_v4().into_iter().collect::<Vec<_>>();
                addresses.sort();
                let Some(address) = addresses
                    .into_iter()
                    .find(|address| is_local_address(IpAddr::V4(*address)))
                else {
                    return;
                };
                if !valid_discovery_metadata(device_id, name, fingerprint) {
                    return;
                }
                let paired = self
                    .inner
                    .identity
                    .trusted_device(device_id)
                    .ok()
                    .flatten()
                    .is_some_and(|trusted| trusted.certificate_fingerprint == fingerprint);
                let device = NearbyDevice {
                    device_id: device_id.to_owned(),
                    device_name: name.to_owned(),
                    platform: info
                        .get_property_val_str("platform")
                        .unwrap_or("unknown")
                        .chars()
                        .take(24)
                        .collect(),
                    address: address.to_string(),
                    port: info.get_port(),
                    protocol_version: version,
                    certificate_fingerprint: fingerprint.to_ascii_lowercase(),
                    paired,
                    last_seen: now_millis(),
                };
                if let (Ok(mut names), Ok(mut devices)) =
                    (self.inner.service_names.write(), self.inner.devices.write())
                {
                    if insert_discovered_device(
                        &mut devices,
                        &mut names,
                        info.get_fullname(),
                        device,
                    ) {
                        drop(devices);
                        drop(names);
                        self.emit_devices();
                    }
                }
            }
            ServiceEvent::ServiceRemoved(_, fullname) => {
                let device_id = self
                    .inner
                    .service_names
                    .write()
                    .ok()
                    .and_then(|mut names| names.remove(&fullname));
                if let Some(device_id) = device_id {
                    if let Ok(mut devices) = self.inner.devices.write() {
                        devices.remove(&device_id);
                    }
                    self.emit_devices();
                }
            }
            _ => {}
        }
    }

    fn device(&self, device_id: &str) -> Result<NearbyDevice, NearbyError> {
        self.inner
            .devices
            .read()
            .map_err(|_| NearbyError::StateUnavailable)?
            .get(device_id)
            .cloned()
            .ok_or(NearbyError::NotFound)
    }

    fn control(&self, transfer_id: &str) -> Result<Arc<TransferControl>, NearbyError> {
        self.inner
            .controls
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .get(transfer_id)
            .cloned()
            .ok_or(NearbyError::NotFound)
    }

    fn has_resume_approval(
        &self,
        transfer_id: &str,
        device_id: &str,
        files: &[LanFile],
        total_bytes: u64,
    ) -> Result<bool, NearbyError> {
        let now = Instant::now();
        let mut approvals = self
            .inner
            .approved_incoming
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?;
        approvals.retain(|_, approval| approval.expires_at > now);
        Ok(approvals.get(transfer_id).is_some_and(|approval| {
            approval.device_id == device_id
                && approval.total_bytes == total_bytes
                && approval.files == files
        }))
    }

    fn remember_incoming_approval(
        &self,
        transfer_id: &str,
        device_id: &str,
        files: &[LanFile],
        total_bytes: u64,
    ) -> Result<(), NearbyError> {
        let now = Instant::now();
        let mut approvals = self
            .inner
            .approved_incoming
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?;
        approvals.retain(|_, approval| approval.expires_at > now);
        if approvals.len() >= MAX_RESUME_APPROVALS {
            if let Some(oldest) = approvals
                .iter()
                .min_by_key(|(_, approval)| approval.expires_at)
                .map(|(transfer_id, _)| transfer_id.clone())
            {
                approvals.remove(&oldest);
            }
        }
        approvals.insert(
            transfer_id.to_owned(),
            ApprovedIncomingTransfer {
                device_id: device_id.to_owned(),
                files: files.to_vec(),
                total_bytes,
                expires_at: now + RESUME_APPROVAL_TTL,
            },
        );
        Ok(())
    }

    fn clear_incoming_approval(&self, transfer_id: &str) {
        if let Ok(mut approvals) = self.inner.approved_incoming.lock() {
            approvals.remove(transfer_id);
        }
    }

    fn listening_port(&self) -> Result<Option<u16>, NearbyError> {
        Ok(self
            .inner
            .runtime
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?
            .as_ref()
            .map(|runtime| runtime.listening_port))
    }

    fn insert_pairing_decision(
        &self,
        pairing_id: String,
        sender: oneshot::Sender<bool>,
    ) -> Result<(), NearbyError> {
        let mut decisions = self
            .inner
            .pairing_decisions
            .lock()
            .map_err(|_| NearbyError::StateUnavailable)?;
        if decisions.len() >= MAX_CONCURRENT_CONNECTIONS {
            return Err(NearbyError::Busy);
        }
        decisions.insert(pairing_id, sender);
        Ok(())
    }

    fn remove_pairing_decision(&self, pairing_id: &str) {
        if let Ok(mut decisions) = self.inner.pairing_decisions.lock() {
            decisions.remove(pairing_id);
        }
    }

    fn emit_devices(&self) {
        if let Ok(status) = self.status() {
            let _ = self.inner.app.emit("nearby-devices", status.devices);
        }
    }

    fn emit_pairing_result(
        &self,
        pairing_id: &str,
        device_id: &str,
        result: &Result<(), NearbyError>,
    ) {
        let payload = PairingResult {
            pairing_id: pairing_id.to_owned(),
            device_id: device_id.to_owned(),
            accepted: result.is_ok(),
            error: result.as_ref().err().map(|error| error.to_string()),
        };
        let _ = self.inner.app.emit("nearby-pairing-result", payload);
    }

    fn refresh_pair_state(&self, device_id: &str) {
        if let Ok(mut devices) = self.inner.devices.write() {
            if let Some(device) = devices.get_mut(device_id) {
                device.paired = self
                    .inner
                    .identity
                    .trusted_device(device_id)
                    .ok()
                    .flatten()
                    .is_some_and(|trusted| {
                        trusted.certificate_fingerprint == device.certificate_fingerprint
                    });
            }
        }
        self.emit_devices();
    }

    fn upsert_snapshot(&self, snapshot: NearbyTransferSnapshot) {
        if let Ok(mut transfers) = self.inner.transfers.write() {
            transfers.insert(snapshot.id.clone(), snapshot.clone());
        }
        let _ = self.inner.app.emit("nearby-transfer-progress", snapshot);
    }

    fn set_transfer_status(&self, transfer_id: &str, status: &str, error: Option<String>) {
        let snapshot = if let Ok(mut transfers) = self.inner.transfers.write() {
            let updated = transfers.get_mut(transfer_id).map(|snapshot| {
                snapshot.status = status.to_owned();
                snapshot.error = error;
                snapshot.updated_at = now_millis();
                snapshot.clone()
            });
            if matches!(status, "COMPLETED" | "FAILED" | "CANCELLED") {
                prune_terminal_transfers(&mut transfers);
            }
            updated
        } else {
            None
        };
        if let Some(snapshot) = snapshot {
            let _ = self.inner.app.emit("nearby-transfer-progress", snapshot);
            if matches!(status, "COMPLETED" | "FAILED" | "CANCELLED") {
                self.persist_transfer_history();
            }
        }
    }

    fn set_transfer_progress(&self, transfer_id: &str, transferred: u64, speed: u64) {
        let snapshot = if let Ok(mut transfers) = self.inner.transfers.write() {
            transfers.get_mut(transfer_id).map(|snapshot| {
                snapshot.transferred_bytes = transferred.min(snapshot.total_bytes);
                snapshot.bytes_per_second = speed;
                snapshot.eta_seconds = snapshot
                    .total_bytes
                    .saturating_sub(transferred)
                    .checked_div(speed);
                snapshot.updated_at = now_millis();
                snapshot.clone()
            })
        } else {
            None
        };
        if let Some(snapshot) = snapshot {
            let _ = self.inner.app.emit("nearby-transfer-progress", snapshot);
        }
    }

    fn persist_transfer_history(&self) {
        let Ok(transfers) = self.inner.transfers.read() else {
            return;
        };
        let mut history = transfers
            .values()
            .filter(|snapshot| {
                matches!(
                    snapshot.status.as_str(),
                    "COMPLETED" | "FAILED" | "CANCELLED"
                )
            })
            .cloned()
            .collect::<Vec<_>>();
        history.sort_by_key(|snapshot| std::cmp::Reverse(snapshot.updated_at));
        history.truncate(MAX_TRANSFER_HISTORY);
        if let Ok(payload) = serde_json::to_vec_pretty(&history) {
            let mut options = std::fs::OpenOptions::new();
            options.create(true).truncate(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            if let Ok(mut file) = options.open(&self.inner.history_path) {
                use std::io::Write;
                let _ = file.write_all(&payload).and_then(|_| file.sync_all());
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &self.inner.history_path,
                        std::fs::Permissions::from_mode(0o600),
                    );
                }
            }
        }
    }
}

fn load_transfer_history(
    path: &std::path::Path,
) -> Result<HashMap<String, NearbyTransferSnapshot>, NearbyError> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let payload = std::fs::read(path)?;
    if payload.len() > 2 * 1024 * 1024 {
        return Ok(HashMap::new());
    }
    let parsed: Result<Vec<NearbyTransferSnapshot>, _> = serde_json::from_slice(&payload);
    let Ok(mut history) = parsed else {
        return Ok(HashMap::new());
    };
    history.retain(|snapshot| {
        snapshot.id.len() >= 8
            && snapshot.id.len() <= 128
            && snapshot.device_id.len() <= 128
            && snapshot.device_name.len() <= 64
            && matches!(snapshot.direction.as_str(), "SEND" | "RECEIVE")
            && matches!(
                snapshot.status.as_str(),
                "COMPLETED" | "FAILED" | "CANCELLED"
            )
            && validate_manifest(&snapshot.files).is_ok_and(|total| total == snapshot.total_bytes)
            && snapshot.transferred_bytes <= snapshot.total_bytes
            && (snapshot.status != "COMPLETED"
                || snapshot.transferred_bytes == snapshot.total_bytes)
    });
    history.truncate(MAX_TRANSFER_HISTORY);
    Ok(history
        .into_iter()
        .map(|snapshot| (snapshot.id.clone(), snapshot))
        .collect())
}

fn insert_discovered_device(
    devices: &mut HashMap<String, NearbyDevice>,
    service_names: &mut HashMap<String, String>,
    fullname: &str,
    device: NearbyDevice,
) -> bool {
    if !devices.contains_key(&device.device_id) && devices.len() >= MAX_DISCOVERED_DEVICES {
        let Some(evicted_id) = devices
            .values()
            .filter(|candidate| !candidate.paired)
            .min_by_key(|candidate| candidate.last_seen)
            .map(|candidate| candidate.device_id.clone())
        else {
            return false;
        };
        devices.remove(&evicted_id);
        service_names.retain(|_, device_id| device_id != &evicted_id);
    }

    if !service_names.contains_key(fullname) && service_names.len() >= MAX_DISCOVERY_SERVICE_NAMES {
        if let Some(stale_name) = service_names
            .iter()
            .find(|(_, device_id)| !devices.contains_key(*device_id))
            .map(|(name, _)| name.clone())
            .or_else(|| service_names.keys().next().cloned())
        {
            service_names.remove(&stale_name);
        }
    }
    service_names.insert(fullname.to_owned(), device.device_id.clone());
    devices.insert(device.device_id.clone(), device);
    true
}

fn prune_terminal_transfers(transfers: &mut HashMap<String, NearbyTransferSnapshot>) {
    let mut terminal = transfers
        .values()
        .filter(|snapshot| {
            matches!(
                snapshot.status.as_str(),
                "COMPLETED" | "FAILED" | "CANCELLED"
            )
        })
        .map(|snapshot| (snapshot.id.clone(), snapshot.updated_at))
        .collect::<Vec<_>>();
    if terminal.len() <= MAX_TRANSFER_HISTORY {
        return;
    }
    terminal.sort_by_key(|(_, updated_at)| std::cmp::Reverse(*updated_at));
    for (transfer_id, _) in terminal.into_iter().skip(MAX_TRANSFER_HISTORY) {
        transfers.remove(&transfer_id);
    }
}

fn parse_challenge(
    challenge: WireMessage,
    device: &NearbyDevice,
) -> Result<(String, String, String, String), NearbyError> {
    let WireMessage::Challenge {
        protocol_version,
        server_nonce,
        server_device_id,
        server_device_name,
        certificate_fingerprint,
    } = challenge
    else {
        return Err(NearbyError::Authentication);
    };
    if protocol_version != LAN_PROTOCOL_VERSION
        || server_device_id != device.device_id
        || certificate_fingerprint != device.certificate_fingerprint
        || server_nonce.len() > 128
        || server_device_name.len() > 64
    {
        return Err(NearbyError::Authentication);
    }
    Ok((
        server_nonce,
        server_device_id,
        server_device_name,
        certificate_fingerprint,
    ))
}

fn validate_auth_fields(
    protocol_version: u16,
    device_id: &str,
    device_name: &str,
    fingerprint: &str,
    expected_fingerprint: &str,
    nonce: &str,
) -> Result<(), NearbyError> {
    if protocol_version != LAN_PROTOCOL_VERSION {
        return Err(NearbyError::ProtocolVersion);
    }
    if device_id.len() < 8
        || device_id.len() > 128
        || device_name.is_empty()
        || device_name.len() > 64
        || nonce.is_empty()
        || nonce.len() > 128
        || fingerprint.len() != 64
        || expected_fingerprint.len() != 64
        || !fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !expected_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(NearbyError::Authentication);
    }
    Ok(())
}

fn auth_parts<'a>(
    label: &'a [u8],
    server_nonce: &'a str,
    client_nonce: &'a str,
    client_id: &'a str,
    server_id: &'a str,
    client_fingerprint: &'a str,
    server_fingerprint: &'a str,
) -> [&'a [u8]; 7] {
    [
        label,
        server_nonce.as_bytes(),
        client_nonce.as_bytes(),
        client_id.as_bytes(),
        server_id.as_bytes(),
        client_fingerprint.as_bytes(),
        server_fingerprint.as_bytes(),
    ]
}

async fn validate_source(source: &LocalSource) -> Result<(), NearbyError> {
    let metadata = tokio::fs::metadata(&source.path).await?;
    let modified_at = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if !metadata.is_file()
        || metadata.len() != source.file.size
        || modified_at != source.file.modified_at
    {
        return Err(NearbyError::SourceChanged(source.file.name.clone()));
    }
    Ok(())
}

async fn read_message_controlled<S>(
    stream: &mut S,
    control: &Arc<TransferControl>,
    transfer_id: &str,
    timeout_duration: Duration,
) -> Result<WireMessage, NearbyError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    if let Err(error) = control.wait_ready().await {
        let _ = timeout(
            CONNECTION_TIMEOUT,
            write_message(
                stream,
                &WireMessage::Cancel {
                    transfer_id: transfer_id.to_owned(),
                },
            ),
        )
        .await;
        return Err(error);
    }
    let mut read_future = Box::pin(read_message(stream));
    let mut remaining = timeout_duration;
    loop {
        let started = Instant::now();
        let mut timer = Box::pin(tokio::time::sleep(remaining));
        tokio::select! {
            result = &mut read_future => return result,
            _ = &mut timer => return Err(NearbyError::Timeout),
            _ = control.changed.notified() => {
                remaining = remaining.saturating_sub(started.elapsed());
                if let Err(error) = control.wait_ready().await {
                    drop(read_future);
                    let _ = timeout(
                        CONNECTION_TIMEOUT,
                        write_message(
                            stream,
                            &WireMessage::Cancel {
                                transfer_id: transfer_id.to_owned(),
                            },
                        ),
                    )
                    .await;
                    return Err(error);
                }
            }
        }
    }
}

fn is_local_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private() || address.is_link_local() || address.is_loopback()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unicast_link_local()
                || (address.segments()[0] & 0xfe00) == 0xfc00
        }
    }
}

fn valid_discovery_metadata(device_id: &str, name: &str, fingerprint: &str) -> bool {
    (8..=128).contains(&device_id.len())
        && !name.is_empty()
        && name.len() <= 64
        && sanitize_device_name(name) == name
        && fingerprint.len() == 64
        && fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_retryable_connection_error(error: &NearbyError) -> bool {
    matches!(error, NearbyError::Io(_) | NearbyError::TokioTimeout(_))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_private_and_link_local_addresses_are_allowed() {
        assert!(is_local_address("192.168.1.10".parse().unwrap()));
        assert!(is_local_address("10.0.0.2".parse().unwrap()));
        assert!(is_local_address("169.254.10.2".parse().unwrap()));
        assert!(is_local_address("127.0.0.1".parse().unwrap()));
        assert!(!is_local_address("8.8.8.8".parse().unwrap()));
        assert!(!is_local_address("1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn rate_limiter_bounds_each_lan_address_and_recovers() {
        let limiter = IpRateLimiter::default();
        let address = "192.168.1.10".parse().unwrap();
        let started = Instant::now();
        for _ in 0..MAX_CONNECTIONS_PER_IP_PER_MINUTE {
            assert!(limiter.allow(address, started));
        }
        assert!(!limiter.allow(address, started));
        assert!(limiter.allow(address, started + Duration::from_secs(61)));
        assert!(limiter.allow("192.168.1.11".parse().unwrap(), started));
    }

    #[test]
    fn discovery_metadata_is_strictly_bounded() {
        let fingerprint = "a".repeat(64);
        assert!(valid_discovery_metadata(
            "device-12345678",
            "Living Room Mac",
            &fingerprint
        ));
        assert!(!valid_discovery_metadata("short", "Mac", &fingerprint));
        assert!(!valid_discovery_metadata(
            "device-12345678",
            "bad\nname",
            &fingerprint
        ));
        assert!(!valid_discovery_metadata(
            "device-12345678",
            "Mac",
            &"z".repeat(64)
        ));
    }

    #[test]
    fn discovery_flood_cannot_grow_device_or_service_maps_without_bound() {
        let mut devices = HashMap::new();
        let mut service_names = HashMap::new();
        for index in 0..(MAX_DISCOVERED_DEVICES + 32) {
            let device = NearbyDevice {
                device_id: format!("device-{index:08}"),
                device_name: format!("Device {index}"),
                platform: "test".to_owned(),
                address: "192.168.1.10".to_owned(),
                port: 8788,
                protocol_version: LAN_PROTOCOL_VERSION,
                certificate_fingerprint: "a".repeat(64),
                paired: index == 0,
                last_seen: index as u64,
            };
            assert!(insert_discovered_device(
                &mut devices,
                &mut service_names,
                &format!("service-{index}"),
                device,
            ));
        }
        assert_eq!(devices.len(), MAX_DISCOVERED_DEVICES);
        assert!(devices.contains_key("device-00000000"));

        let existing = devices["device-00000000"].clone();
        for index in 0..(MAX_DISCOVERY_SERVICE_NAMES + 32) {
            assert!(insert_discovered_device(
                &mut devices,
                &mut service_names,
                &format!("alias-{index}"),
                existing.clone(),
            ));
        }
        assert!(service_names.len() <= MAX_DISCOVERY_SERVICE_NAMES);
    }

    #[test]
    fn terminal_transfer_history_is_pruned_in_memory() {
        let mut transfers = HashMap::new();
        for index in 0..(MAX_TRANSFER_HISTORY + 10) {
            let id = format!("transfer-{index:08}");
            transfers.insert(
                id.clone(),
                NearbyTransferSnapshot {
                    id,
                    device_id: "device-12345678".to_owned(),
                    device_name: "Trusted Mac".to_owned(),
                    direction: "RECEIVE".to_owned(),
                    files: Vec::new(),
                    total_bytes: 0,
                    transferred_bytes: 0,
                    bytes_per_second: 0,
                    eta_seconds: None,
                    status: "COMPLETED".to_owned(),
                    error: None,
                    updated_at: index as u64,
                },
            );
        }
        transfers.insert(
            "active-transfer".to_owned(),
            NearbyTransferSnapshot {
                id: "active-transfer".to_owned(),
                device_id: "device-12345678".to_owned(),
                device_name: "Trusted Mac".to_owned(),
                direction: "SEND".to_owned(),
                files: Vec::new(),
                total_bytes: 1,
                transferred_bytes: 0,
                bytes_per_second: 0,
                eta_seconds: None,
                status: "TRANSFERRING".to_owned(),
                error: None,
                updated_at: 0,
            },
        );

        prune_terminal_transfers(&mut transfers);
        assert_eq!(transfers.len(), MAX_TRANSFER_HISTORY + 1);
        assert!(transfers.contains_key("active-transfer"));
        assert!(!transfers.contains_key("transfer-00000000"));
        assert!(transfers.contains_key(&format!("transfer-{:08}", MAX_TRANSFER_HISTORY + 9)));
    }

    #[tokio::test]
    async fn transfer_control_pauses_resumes_and_cancels() {
        let control = Arc::new(TransferControl::new());
        control.pause();
        let waiting = {
            let control = control.clone();
            tokio::spawn(async move { control.wait_ready().await })
        };
        assert!(tokio::time::timeout(Duration::from_millis(20), async {
            while !waiting.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .is_err());
        control.resume();
        assert!(waiting.await.unwrap().is_ok());
        control.cancel();
        assert!(matches!(
            control.wait_ready().await,
            Err(NearbyError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn controlled_reads_preserve_frames_across_pause_and_signal_cancel() {
        let (mut receiver, mut sender) = tokio::io::duplex(4096);
        let control = Arc::new(TransferControl::new());
        let reader_control = control.clone();
        let reader = tokio::spawn(async move {
            read_message_controlled(
                &mut receiver,
                &reader_control,
                "transfer-12345678",
                Duration::from_secs(2),
            )
            .await
        });
        control.pause();
        write_message(
            &mut sender,
            &WireMessage::Ack {
                transfer_id: "transfer-12345678".to_owned(),
                file_id: "file-12345678".to_owned(),
                received_offset: 4,
            },
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!reader.is_finished());
        control.resume();
        assert!(matches!(
            reader.await.unwrap().unwrap(),
            WireMessage::Ack {
                received_offset: 4,
                ..
            }
        ));

        let (mut receiver, mut sender) = tokio::io::duplex(4096);
        let control = Arc::new(TransferControl::new());
        let reader_control = control.clone();
        let reader = tokio::spawn(async move {
            read_message_controlled(
                &mut receiver,
                &reader_control,
                "transfer-87654321",
                Duration::from_secs(2),
            )
            .await
        });
        control.cancel();
        assert!(matches!(reader.await.unwrap(), Err(NearbyError::Cancelled)));
        assert!(matches!(
            read_message(&mut sender).await.unwrap(),
            WireMessage::Cancel { transfer_id } if transfer_id == "transfer-87654321"
        ));
    }

    #[test]
    fn transfer_history_ignores_corruption_and_loads_terminal_entries() {
        let root =
            std::env::temp_dir().join(format!("directdrop-history-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("history.json");
        std::fs::write(&path, b"not-json").unwrap();
        assert!(load_transfer_history(&path).unwrap().is_empty());

        let snapshot = NearbyTransferSnapshot {
            id: "transfer-12345678".to_owned(),
            device_id: "device-12345678".to_owned(),
            device_name: "Trusted Mac".to_owned(),
            direction: "RECEIVE".to_owned(),
            files: vec![LanFile {
                id: "file-12345678".to_owned(),
                name: "safe.txt".to_owned(),
                relative_path: "safe.txt".to_owned(),
                size: 1,
                mime_type: "text/plain".to_owned(),
                modified_at: 0,
            }],
            total_bytes: 1,
            transferred_bytes: 1,
            bytes_per_second: 0,
            eta_seconds: None,
            status: "COMPLETED".to_owned(),
            error: None,
            updated_at: 1,
        };
        std::fs::write(&path, serde_json::to_vec(&vec![snapshot]).unwrap()).unwrap();
        assert_eq!(load_transfer_history(&path).unwrap().len(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
