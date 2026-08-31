//! 档案备份与还原。
//!
//! 把 `$DSH_HOME` 打包为版本化的 `.tar.zst` 快照，存放在 `$DSH_HOME/.backups/`，
//! 支持手动创建 / 还原（覆盖或新建）/ 列表 / 删除，以及自动备份调度与保留份数裁剪。

pub mod archive;
pub mod retention;
pub mod schedule;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;

use crate::config;

/// 备份操作全局互斥锁：序列化同一数据目录下的并发创建/删除，避免清单
/// 读写竞争导致条目丢失或归档文件覆盖。
static BACKUP_LOCK: Mutex<()> = Mutex::new(());

/// 备份选项。
#[derive(Debug, Clone)]
pub struct BackupOptions {
    /// 是否包含凭据文件（`.credentials.yaml`）。默认 false。
    pub include_credentials: bool,
}

/// 备份信息（序列化 camelCase 给前端）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// 快照时间戳（文件名主体，如 `2026-08-30T12-00-00`）。
    pub timestamp: String,
    /// 归档文件完整路径。
    pub path: String,
    /// 归档文件大小（字节）。
    pub size: u64,
    /// 是否包含凭据。
    pub include_credentials: bool,
}

/// 还原模式。
#[derive(Debug, Clone, Copy)]
pub enum RestoreMode {
    /// 覆盖当前 `$DSH_HOME`。
    Overwrite,
    /// 创建新档案目录并解压到其中。
    AsNew,
}

/// 备份清单（索引文件 `.manifest.json` 的内容）。
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct BackupManifest {
    backups: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    timestamp: String,
    path: String,
    size: u64,
    include_credentials: bool,
}

/// 获取备份目录（`$DSH_HOME/.backups/`），不存在时自动创建。
pub fn get_backup_dir(app_handle: &AppHandle) -> PathBuf {
    let dir = config::get_dsh_data_path(app_handle).join(".backups");
    fs::create_dir_all(&dir).ok();
    dir
}

/// 从时间戳推导归档文件名。
fn archive_filename(timestamp: &str) -> String {
    format!("{timestamp}.tar.zst")
}

/// 清单读取错误。
#[derive(Debug)]
enum ManifestError {
    /// 清单文件存在但无法解析（损坏），已另存为 .corrupt 以便人工恢复。
    ParseError(String),
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ManifestError::ParseError(e) => write!(f, "manifest parse error: {e}"),
        }
    }
}

impl std::error::Error for ManifestError {}

/// 读取备份清单。
///
/// - 清单不存在 → 返回空（首次备份的合法空状态）。
/// - 清单存在但损坏 → 另存为 `.corrupt` 以便人工恢复，并返回错误，避免
///   `create_backup` / `delete_backup` 用空清单覆盖导致既有索引丢失。
fn read_manifest(backup_dir: &Path) -> Result<BackupManifest, ManifestError> {
    let path = backup_dir.join(".manifest.json");
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        // 清单不存在 → 首次备份的合法空状态，返回空清单
        Err(_) => return Ok(BackupManifest { backups: vec![] }),
    };
    if content.trim().is_empty() {
        return Err(ManifestError::ParseError("empty manifest".into()));
    }
    match serde_json::from_str(&content) {
        Ok(manifest) => Ok(manifest),
        Err(e) => {
            log::error!("BACKUP_MANIFEST_PARSE: {} {e}", path.display());
            let _ = fs::rename(&path, path.with_extension("corrupt"));
            Err(ManifestError::ParseError(e.to_string()))
        }
    }
}

/// 原子写入备份清单（唯一临时文件名，避免并发写入覆盖）。
fn write_manifest(backup_dir: &Path, manifest: &BackupManifest) -> Result<(), String> {
    let path = backup_dir.join(".manifest.json");
    // 唯一临时文件名：PID + 纳秒时间戳，并发写入互不覆盖
    let tmp_name = format!(".manifest.{}.{}.tmp", std::process::id(), timestamp_nanos());
    let tmp = backup_dir.join(tmp_name);
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("BACKUP_MANIFEST_SERIALIZE: {e}"))?;
    fs::write(&tmp, content).map_err(|e| format!("BACKUP_MANIFEST_WRITE: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("BACKUP_MANIFEST_RENAME: {e}"))?;
    Ok(())
}

/// 当前纳秒时间戳（用于生成唯一临时文件名）。
fn timestamp_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

/// 生成基础时间戳（UTC，格式 `2026-08-30T12-00-00`）。
fn now_timestamp() -> String {
    use time::OffsetDateTime;
    let now = OffsetDateTime::now_utc();
    let date = now.date();
    let time = now.time();
    format!(
        "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}",
        date.year(),
        date.month() as u8,
        date.day(),
        time.hour(),
        time.minute(),
        time.second()
    )
}

/// 生成碰撞安全的归档路径：若同名文件已存在，追加 `-2`、`-3`… 直到空闲。
/// 调用方需持有 `BACKUP_LOCK` 以保证检查-创建的原子性。
fn collision_safe_path(backup_dir: &Path, timestamp: &str) -> PathBuf {
    let mut candidate = backup_dir.join(archive_filename(timestamp));
    let mut counter = 1;
    while candidate.exists() {
        counter += 1;
        let ts = format!("{timestamp}-{counter}");
        candidate = backup_dir.join(archive_filename(&ts));
    }
    candidate
}

/// 创建备份。
///
/// 把 `$DSH_HOME` 打包到 `$DSH_HOME/.backups/<timestamp>.tar.zst`，更新清单，
/// 并按保留份数裁剪。
pub fn create_backup(
    app_handle: &AppHandle,
    options: BackupOptions,
) -> Result<BackupInfo, String> {
    // 序列化并发创建：避免同一秒内归档文件名碰撞 + 清单读写竞争
    let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let backup_dir = get_backup_dir(app_handle);
    let timestamp = now_timestamp();
    // 碰撞安全：同名文件已存在时追加 -2、-3…（锁内检查-创建保证原子性）
    let dest = collision_safe_path(&backup_dir, &timestamp);
    let source = config::get_dsh_data_path(app_handle);

    archive::create_archive(&source, &dest, options.include_credentials)?;

    let size = fs::metadata(&dest)
        .map(|m| m.len())
        .unwrap_or(0);

    let info = BackupInfo {
        timestamp: timestamp.clone(),
        path: dest.to_string_lossy().into_owned(),
        size,
        include_credentials: options.include_credentials,
    };

    // 更新清单：清单损坏时中止写入，避免用空清单覆盖导致既有索引丢失
    let mut manifest = read_manifest(&backup_dir)
        .map_err(|e| format!("BACKUP_MANIFEST_CORRUPT: {e}"))?;
    manifest.backups.push(ManifestEntry {
        timestamp: info.timestamp.clone(),
        path: info.path.clone(),
        size: info.size,
        include_credentials: info.include_credentials,
    });
    write_manifest(&backup_dir, &manifest)?;

    // 裁剪
    prune_if_needed(app_handle)?;

    Ok(info)
}

/// 列出所有备份（按时间戳升序）。
pub fn list_backups(app_handle: &AppHandle) -> Vec<BackupInfo> {
    let backup_dir = get_backup_dir(app_handle);
    // 清单损坏时返回空列表（不抛错），避免影响页面其余部分；写入路径会另行中止
    let manifest = match read_manifest(&backup_dir) {
        Ok(m) => m,
        Err(e) => {
            log::error!("[backup] list_backups: manifest unreadable: {e}");
            return vec![]
        }
    };
    manifest
        .backups
        .into_iter()
        .map(|e| BackupInfo {
            timestamp: e.timestamp,
            path: e.path,
            size: e.size,
            include_credentials: e.include_credentials,
        })
        .collect()
}

/// 删除指定备份（文件 + 清单条目）。
///
/// `timestamp` 会经过 `fs_guard::validate_id` 校验，防路径穿越。
pub fn delete_backup(app_handle: &AppHandle, timestamp: &str) -> Result<(), String> {
    crate::service::fs_guard::validate_id(timestamp)?;
    // 序列化：与 create_backup 共用锁，避免删除与创建并发时清单竞争
    let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let backup_dir = get_backup_dir(app_handle);
    let filename = archive_filename(timestamp);
    let file = backup_dir.join(&filename);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("BACKUP_DELETE_FILE: {e}"))?;
    }
    // 清单损坏时中止写入，避免用空清单覆盖导致既有索引丢失
    let mut manifest = match read_manifest(&backup_dir) {
        Ok(m) => m,
        Err(e) => return Err(format!("BACKUP_MANIFEST_CORRUPT: {e}")),
    };
    manifest.backups.retain(|e| e.timestamp != timestamp);
    write_manifest(&backup_dir, &manifest)?;
    Ok(())
}

/// 还原备份。
///
/// `mode` 为 `Overwrite` 时覆盖当前 `$DSH_HOME`（调用方应先停止服务）；
/// `AsNew` 时创建新档案目录并解压到其中。
///
/// `timestamp` 经过 `fs_guard::validate_id` 校验。
pub fn restore_backup(
    app_handle: &AppHandle,
    timestamp: &str,
    mode: RestoreMode,
) -> Result<(), String> {
    crate::service::fs_guard::validate_id(timestamp)?;
    let backup_dir = get_backup_dir(app_handle);
    let filename = archive_filename(timestamp);
    let archive_path = backup_dir.join(&filename);
    if !archive_path.exists() {
        return Err(format!(
            "BACKUP_NOT_FOUND: backup {timestamp} does not exist"
        ));
    }

    match mode {
        RestoreMode::Overwrite => {
            let dest = config::get_dsh_data_path(app_handle);
            archive::extract_archive(&archive_path, &dest)?;
        }
        RestoreMode::AsNew => {
            // 创建新档案目录：$DSH_HOME/profiles/<timestamp>
            let profiles_root = config::get_dsh_data_path(app_handle).join("profiles");
            fs::create_dir_all(&profiles_root).map_err(|e| {
                format!("BACKUP_RESTORE_MKDIR_PROFILES: {e}")
            })?;
            let new_dir = profiles_root.join(format!("restored-{timestamp}"));
            archive::extract_archive(&archive_path, &new_dir)?;
        }
    }
    Ok(())
}

/// 按保留份数裁剪旧备份（超出时删除最旧的）。
pub fn prune_if_needed(app_handle: &AppHandle) -> Result<(), String> {
    let setting = config::get_store_dat_setting(app_handle);
    retention::prune_old_backups(app_handle, setting.backup_retention_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_format_is_valid() {
        let ts = now_timestamp();
        // 格式：YYYY-MM-DDTHH-MM-SS
        assert!(ts.contains('T'), "时间戳应包含 T 分隔符: {ts}");
        assert_eq!(ts.len(), 19, "时间戳长度应为 19: {ts}");
        assert!(ts.chars().nth(4) == Some('-'));
        assert!(ts.chars().nth(7) == Some('-'));
    }

    #[test]
    fn manifest_round_trip() {
        let dir = std::env::temp_dir().join(format!("dsh-backup-manifest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let manifest = BackupManifest {
            backups: vec![ManifestEntry {
                timestamp: "2026-08-30T12-00-00".to_string(),
                path: "/tmp/x.tar.gz".to_string(),
                size: 100,
                include_credentials: false,
            }],
        };
        write_manifest(&dir, &manifest).unwrap();
        let read = read_manifest(&dir).unwrap();
        assert_eq!(read.backups.len(), 1);
        assert_eq!(read.backups[0].timestamp, "2026-08-30T12-00-00");
        assert_eq!(read.backups[0].size, 100);

        let _ = fs::remove_dir_all(&dir);
    }
}
