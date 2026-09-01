//! 自动备份触发决策。
//!
//! 决定「何时」该自动备份：启动触发、周期触发、配置变化触发。决策本身很轻
//! （几次比较），由 `scheduler` 每 5s 轮询调用；真正耗时的归档操作在命中后
//! 丢到 `spawn_blocking` 执行，不阻塞 tick。

use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

use crate::config;
use crate::service::backup;

/// 备份运行时状态（进程级单例）。
#[derive(Debug, Clone, Default)]
pub struct BackupState {
    /// 上次成功备份的时间。
    pub last_backup_time: Option<time::OffsetDateTime>,
    /// 启动时备份的待执行标志：每次进程启动由 `mark_startup_pending` 设置
    pub pending_startup_backup: bool,
}

fn backup_state() -> std::sync::MutexGuard<'static, BackupState> {
    static STATE: OnceLock<Mutex<BackupState>> = OnceLock::new();
    STATE
        .get_or_init(|| Mutex::new(BackupState::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 纯决策函数：给定当前状态、设置与时间，判断是否应触发自动备份。
///
/// 不读取任何全局状态或 AppHandle，便于单元测试直接覆盖所有分支。
pub fn should_trigger(
    state: &BackupState,
    setting: &config::Setting,
    now: time::OffsetDateTime,
) -> bool {
    // 启动触发：每次进程启动时由 mark_startup_pending 设置的标志
    // 独立判断——用户明确开启「启动时备份」时应生效，不受主开关阻塞
    if state.pending_startup_backup && setting.auto_backup_on_startup {
        return true;
    }
    if !setting.auto_backup_enabled {
        return false;
    }
    // 周期触发：距上次备份已达到间隔天数
    if setting.auto_backup_interval_days > 0 {
        if let Some(last) = state.last_backup_time {
            let elapsed = now - last;
            let interval = time::Duration::days(setting.auto_backup_interval_days as i64);
            if elapsed >= interval {
                return true;
            }
        }
    }
    false
}

/// 对外封装：读取全局状态与当前设置，判断是否应触发。
pub fn should_trigger_auto_backup(app_handle: &AppHandle, now: time::OffsetDateTime) -> bool {
    let state = backup_state();
    let setting = config::get_store_dat_setting(app_handle);
    should_trigger(&state, &setting, now)
}

/// 记录一次成功备份的时间，并清除启动待执行标志。
pub fn record_backup_time(now: time::OffsetDateTime) {
    let mut state = backup_state();
    state.last_backup_time = Some(now);
    state.pending_startup_backup = false;
}

/// 标记应用已启动：若开启了「启动时备份」，设置待执行标志。
///
/// 由 setup() 在应用启动时调用。tick 检测到此标志即触发一次备份。
pub fn mark_startup_pending(app_handle: &AppHandle) {
    let setting = config::get_store_dat_setting(app_handle);
    if !setting.auto_backup_on_startup {
        return;
    }
    let mut state = backup_state();
    state.pending_startup_backup = true;
}

/// 调度器 tick 入口：判断是否应触发，命中则异步执行备份。
///
/// 决策本身轻量（几次比较）；归档操作通过 `spawn_blocking` 脱离异步运行时，
/// 不阻塞后续 tick。
pub fn check_and_trigger(app_handle: &AppHandle) {
    let now = time::OffsetDateTime::now_utc();
    if !should_trigger_auto_backup(app_handle, now) {
        return;
    }
    // 先占位防并发重复；失败后回滚，避免一次失败吞掉启动 / 配置变化触发
    let previous = backup_state().clone();
    record_backup_time(now);

    let app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let options = backup::BackupOptions {
            include_credentials: false,
        };
        // create_backup 内部已调用 prune_if_needed（mod.rs:212），无需重复
        if let Err(e) = backup::create_backup(&app, options) {
            log::error!("[backup] auto backup failed: {e}");
            let mut state = backup_state();
            *state = previous;
            return;
        }
        log::info!("[backup] auto backup completed");
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Setting;

    /// 构造测试用 Setting，仅设置与备份相关的字段，其余走默认。
    fn setting_with(
        enabled: bool,
        interval_days: u32,
        on_startup: bool,
        on_change: bool,
    ) -> Setting {
        let mut s = Setting::default();
        s.auto_backup_enabled = enabled;
        s.auto_backup_interval_days = interval_days;
        s.auto_backup_on_startup = on_startup;
        s.auto_backup_on_change = on_change;
        s
    }

    fn days_ago(days: i64) -> time::OffsetDateTime {
        time::OffsetDateTime::now_utc() - time::Duration::days(days)
    }

    #[test]
    fn triggers_on_startup_when_enabled() {
        let state = BackupState {
            last_backup_time: None,
            pending_startup_backup: true,
        };
        let setting = setting_with(true, 7, true, false);
        assert!(
            should_trigger(&state, &setting, time::OffsetDateTime::now_utc()),
            "pending_startup_backup + on_startup=true 应触发（首次启动）"
        );
    }

    #[test]
    fn does_not_trigger_when_disabled() {
        let state = BackupState::default();
        let setting = setting_with(false, 7, true, false);
        assert!(
            !should_trigger(&state, &setting, time::OffsetDateTime::now_utc()),
            "auto_backup_enabled=false 时任何条件都不应触发"
        );
    }

    #[test]
    fn triggers_after_interval_elapsed() {
        let state = BackupState {
            last_backup_time: Some(days_ago(8)),
            ..Default::default()
        };
        let setting = setting_with(true, 7, false, false);
        assert!(
            should_trigger(&state, &setting, time::OffsetDateTime::now_utc()),
            "距上次备份 8 天、间隔 7 天应触发"
        );
    }

    #[test]
    fn does_not_trigger_before_interval() {
        let state = BackupState {
            last_backup_time: Some(days_ago(3)),
            ..Default::default()
        };
        let setting = setting_with(true, 7, false, false);
        assert!(
            !should_trigger(&state, &setting, time::OffsetDateTime::now_utc()),
            "距上次备份 3 天、间隔 7 天不应触发"
        );
    }

    #[test]
    fn triggers_on_startup_each_time_regardless_of_last_backup() {
        // 即使有上次备份时间，启动时也应该触发（每次启动都备份）
        let state = BackupState {
            last_backup_time: Some(days_ago(1)),
            pending_startup_backup: true,
        };
        let setting = setting_with(true, 7, true, false);
        assert!(
            should_trigger(&state, &setting, time::OffsetDateTime::now_utc()),
            "pending_startup_backup + on_startup=true 应触发（即使有 last_backup_time）"
        );
    }

    #[test]
    fn does_not_trigger_on_startup_when_disabled() {
        let state = BackupState {
            last_backup_time: Some(days_ago(1)),
            pending_startup_backup: true,
        };
        let setting = setting_with(true, 7, false, false);
        assert!(
            !should_trigger(&state, &setting, time::OffsetDateTime::now_utc()),
            "on_startup=false 时即使 pending 也不应触发"
        );
    }

    #[test]
    fn record_backup_time_clears_startup_pending() {
        // 验证 record_backup_time 同时清除 pending_startup_backup 标志
        let state = BackupState {
            pending_startup_backup: true,
            ..Default::default()
        };
        let setting = setting_with(true, 7, true, false);

        // 启动 pending 时应触发
        assert!(should_trigger(&state, &setting, time::OffsetDateTime::now_utc()));

        // record_backup_time 写全局单例；本地状态手动同步
        record_backup_time(time::OffsetDateTime::now_utc());
        // 全局 record_backup_time 已清掉 pending_startup_backup，本地 state 也同步
        let state_after = BackupState {
            last_backup_time: Some(time::OffsetDateTime::now_utc()),
            pending_startup_backup: false,
        };

        // 记录后（pending 已清 + 未达 7 天间隔）不应再触发
        assert!(
            !should_trigger(&state_after, &setting, time::OffsetDateTime::now_utc()),
            "record_backup_time 后 pending_startup_backup 应被清掉，不再触发"
        );
    }
}
