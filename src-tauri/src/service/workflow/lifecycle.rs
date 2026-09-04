//! Harness 服务生命周期的统一公开入口。
//!
//! 把分散在 launch.rs / process.rs / utils.rs / sweep.rs / health.rs 的
//! 启动 / 关闭 / 重启 / 健康检查 / URL 槽位都汇到这一个 struct 上。
//! 子模块降级为 `pub(super)` 后只被本文件访问；bridge/ 命令经由
//! `HarnessLifecycle::xxx` 单跳转发，不再直接依赖子模块。
//!
//! 设计要点：
//! - unit struct：所有方法都是 associated function；状态全在静态 `OnceLock<Mutex<>>`
//!   槽位里（与 `logger::FRONTDESK_WRITER`、`config::setting::LOCK` 同构），不引入
//!   `app.manage()` / `tauri::State<T>`（项目无此模式）。
//! - 跨子模块的边界一律在这里汇合：`HarnessLifecycle::launch` 触发
//!   `clear_url()` → 子进程 spawn → `utils::spawn_output_readers` 解析 stdout
//!   → `HarnessLifecycle::set_url` + `emit_url_changed` → 前端 iframe 刷新。
//! - 前端 `invoke('launch_harness' | 'shutdown_harness' | 'restart_harness')` 名字
//!   不变；事件名 `"harness-url-detected"` / `"harness-process-exited"` 也不变。

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::health;
use super::launch;
use super::process;
use super::sweep;
use super::utils;

pub struct HarnessLifecycle;

impl HarnessLifecycle {
    /// Tauri 事件名：dsh 启动后从 stdout 解析到带 token 的本地访问地址时推送。
    ///
    /// dsh 上游 `packages/bundle/web-app/src/index.ts: announceReady` 通过
    /// `console.log(`dsh web: ${authenticatedUrl}...`)` 输出 URL；
    /// `authenticatedUrl` 由 `connection.authenticatedUrl(webUrl)` 注入 token
    /// （alpha 浏览器会话鉴权）。桌面端内嵌 WebView 也必须使用这个 token URL，
    /// 否则健康检查拿到鉴权失败页、iframe 永远停在官方 boot 页 "Loading plugins…"。
    pub const URL_EVENT: &'static str = "harness-url-detected";

    /// 当前持有的 Harness 根进程意外退出时通知前端的专用事件。
    pub const PROCESS_EXITED_EVENT: &'static str = "harness-process-exited";

    // ==================== URL 槽位 ====================

    /// 写入新解析到的 dsh token URL；返回写入前槽位里的旧值（用于日志/测试）。
    pub fn set_url(url: String) -> Option<String> {
        let mut guard = harness_url_slot().lock().ok()?;
        guard.replace(url)
    }

    /// 清空当前 token URL（在新进程 spawn 前调用，避免仍指向已死进程的 URL）。
    pub fn clear_url() {
        if let Ok(mut guard) = harness_url_slot().lock() {
            *guard = None;
        }
    }

    /// 读取当前持有的 dsh token URL；前端 iframe 拿这个地址直接访问。
    pub fn get_url() -> Option<String> {
        harness_url_slot().lock().ok().and_then(|g| g.clone())
    }

    /// 通过 Tauri 事件向前端推送 URL 变更（供 `spawn_output_readers` 调用）。
    pub fn emit_url_changed(app: &AppHandle, url: &str) {
        let payload = HarnessUrlPayload { url: url.to_string() };
        let _ = app.emit(Self::URL_EVENT, payload);
    }

    // ==================== 生命周期代理 ====================

    /// 检测环境 + 启动；用于一次性启动路径（`launch` 入口的前置守卫，
    /// 处理 installed / node / dsh 不存在等缺失场景）。
    pub async fn start(app: AppHandle) -> Result<(), String> {
        launch::start(app).await
    }

    /// 拉起 dsh 进程（含端口自愈、token URL 解析、--no-open 标志）。
    /// 启动新进程前会自动 `clear_url()` 清掉旧 token。
    pub async fn launch(app: AppHandle) -> Result<(), String> {
        launch::launch(app).await
    }

    /// 重启：先 stop 再 start（组合操作）。内核侧 = `launch::restart`。
    pub async fn restart(app: AppHandle) -> Result<(), String> {
        launch::restart(app).await
    }

    /// 停止 dsh 进程。内核侧 = `process::stop`（语义化重命名，避免与 Rust
    /// 标准库的 `std::process::exit` 同名混淆）。
    pub async fn shutdown(app: AppHandle) -> Result<(), String> {
        process::stop(app).await
    }

    /// 应用退出时停止 dsh 进程。
    pub fn stop_on_exit(app: AppHandle, port: u16) {
        process::stop_on_exit(app, port)
    }

    /// 核心切换互斥锁（持锁期间可串行化所有启动/清理动作）。
    pub async fn acquire_core_transition()
        -> Result<tokio::sync::OwnedMutexGuard<()>, String>
    {
        process::acquire_core_transition().await
    }

    /// 是否有本应用持有的 dsh 进程在跑（PID + 句柄登记存在）。
    pub fn has_owned_process() -> bool {
        process::has_owned_process()
    }

    /// 按命令行路径精确匹配本应用 dsh 服务，清扫残留孤儿（不杀用户其它 node 进程）。
    pub fn terminate_stale_harness_processes(app: &AppHandle) {
        process::terminate_stale_harness_processes(app)
    }

    /// release 构建下清扫历史残留孤儿 Harness 实例。
    pub fn sweep_orphan_harness(app: &AppHandle) {
        sweep::sweep_orphan_harness(app)
    }

    /// 通过 Rust 代理做健康检查（避免 WebView CORS 问题）。
    pub async fn proxy_health_check(port: u16) -> Result<String, String> {
        health::proxy_health_check(port).await
    }

    /// HTTP 探测判断 dsh 是否在某端口上真的就绪（与 `proxy_health_check` 不同：
    /// 这只检测 TCP 端口是否有响应，不验证 client modules）。后台 tick 任务
    /// 用它辅助区分「持有 PID 但进程崩了」与「仍在启动中」。
    pub async fn is_dsh_running(port: u16) -> bool {
        utils::is_dsh_running(port).await
    }
}

/// 当前持有的 dsh 实例的本地访问地址（含 token）。
///
/// 启动新进程时由 [`crate::service::workflow::utils::spawn_output_readers`]
/// 从 stdout 写入；停进程时 [`crate::service::workflow::launch::launch`] /
/// `restart` 清空（避免 iframe 仍指向已死进程的 token URL）。前端通过
/// [`HarnessLifecycle::URL_EVENT`] 实时接收；`get_runtime_info` /
/// [`HarnessLifecycle::get_url`] 也读这个槽位，确保 fallback 路径
/// （重启早期 / 健康检查未通过）也能拿到最新地址。
static HARNESS_URL: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn harness_url_slot() -> &'static Mutex<Option<String>> {
    HARNESS_URL.get_or_init(|| Mutex::new(None))
}

/// Tauri 事件 payload：`harness-url-detected` 推送给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessUrlPayload {
    pub url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harness_url_round_trip() {
        HarnessLifecycle::clear_url();
        assert_eq!(HarnessLifecycle::get_url(), None);
        let prev = HarnessLifecycle::set_url("http://127.0.0.1:3080/?token=abc".to_string());
        assert_eq!(prev, None);
        assert_eq!(
            HarnessLifecycle::get_url().as_deref(),
            Some("http://127.0.0.1:3080/?token=abc")
        );
        HarnessLifecycle::clear_url();
        assert_eq!(HarnessLifecycle::get_url(), None);
    }

    #[test]
    fn harness_url_replaces_previous() {
        HarnessLifecycle::clear_url();
        HarnessLifecycle::set_url("http://127.0.0.1:3080/?token=old".to_string());
        let prev = HarnessLifecycle::set_url("http://127.0.0.1:3081/?token=new".to_string());
        assert_eq!(prev.as_deref(), Some("http://127.0.0.1:3080/?token=old"));
        assert_eq!(
            HarnessLifecycle::get_url().as_deref(),
            Some("http://127.0.0.1:3081/?token=new")
        );
        HarnessLifecycle::clear_url();
    }

    #[test]
    fn clear_after_set_resets_to_none() {
        HarnessLifecycle::clear_url();
        HarnessLifecycle::set_url("http://127.0.0.1:3080/?token=x".to_string());
        HarnessLifecycle::clear_url();
        assert_eq!(HarnessLifecycle::get_url(), None);
    }
}