//! 档案备份与还原。
//!
//! 把 `$DSH_HOME` 打包为版本化的 `.tar.gz` 快照，存放在 `$DSH_HOME/.backups/`，
//! 支持手动创建 / 还原（覆盖或新建）/ 列表 / 删除，以及自动备份调度与保留份数裁剪。

pub mod archive;

use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::config;

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
    format!("{timestamp}.tar.gz")
}

/// 读取备份清单，不存在时返回空。
fn read_manifest(backup_dir: &Path) -> BackupManifest {
    let path = backup_dir.join(".manifest.json");
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or(BackupManifest { backups: vec![] })
}

/// 原子写入备份清单。
fn write_manifest(backup_dir: &Path, manifest: &BackupManifest) -> Result<(), String> {
    let path = backup_dir.join(".manifest.json");
    let tmp = path.with_extension("tmp");
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("BACKUP_MANIFEST_SERIALIZE: {e}"))?;
    fs::write(&tmp, content).map_err(|e| format!("BACKUP_MANIFEST_WRITE: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("BACKUP_MANIFEST_RENAME: {e}"))?;
    Ok(())
}

/// 生成时间戳（本地时间，格式 `2026-08-30T12-00-00`）。
fn now_timestamp() -> String {
    use time::OffsetDateTime;
    let now = OffsetDateTime::now_utc();
    // 格式：YYYY-MM-DDTHH-MM-SS
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

/// 创建备份。
///
/// 把 `$DSH_HOME` 打包到 `$DSH_HOME/.backups/<timestamp>.tar.gz`，更新清单，
/// 并按保留份数裁剪。
pub fn create_backup(
    app_handle: &AppHandle,
    options: BackupOptions,
) -> Result<BackupInfo, String> {
    let backup_dir = get_backup_dir(app_handle);
    let timestamp = now_timestamp();
    let filename = archive_filename(&timestamp);
    let dest = backup_dir.join(&filename);
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

    // 更新清单
    let mut manifest = read_manifest(&backup_dir);
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
    let manifest = read_manifest(&backup_dir);
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
    let backup_dir = get_backup_dir(app_handle);
    let filename = archive_filename(timestamp);
    let file = backup_dir.join(&filename);
    if file.exists() {
        fs::remove_file(&file).map_err(|e| format!("BACKUP_DELETE_FILE: {e}"))?;
    }
    let mut manifest = read_manifest(&backup_dir);
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
    let retention = setting.backup_retention_count;
    if retention == 0 {
        return Ok(());
    }
    let backup_dir = get_backup_dir(app_handle);
    let mut manifest = read_manifest(&backup_dir);
    if manifest.backups.len() <= retention as usize {
        return Ok(());
    }
    // 按时间戳升序，保留最新的 retention 份
    manifest
        .backups
        .sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    let remove_count = manifest.backups.len() - retention as usize;
    let to_remove: Vec<ManifestEntry> = manifest.backups.drain(..remove_count).collect();
    for entry in &to_remove {
        let file = backup_dir.join(archive_filename(&entry.timestamp));
        if file.exists() {
            fs::remove_file(&file).map_err(|e| format!("BACKUP_PRUNE_FILE: {e}"))?;
        }
    }
    write_manifest(&backup_dir, &manifest)?;
    Ok(())
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
        let read = read_manifest(&dir);
        assert_eq!(read.backups.len(), 1);
        assert_eq!(read.backups[0].timestamp, "2026-08-30T12-00-00");
        assert_eq!(read.backups[0].size, 100);

        let _ = fs::remove_dir_all(&dir);
    }
}
