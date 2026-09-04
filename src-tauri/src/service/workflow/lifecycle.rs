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

    // ==================== URL 槽位（含 generation 防过期覆盖）====================

    /// 写入新解析到的 dsh token URL；只有当 `generation` 仍是当前代时才写入，
    /// 旧 `spawn_output_readers` 线程（restart 后被废弃）传过期 generation 进来
    /// 时**忽略** —— 防止旧进程的 stdout 行覆盖新进程的 URL。
    ///
    /// 返回写入前的旧值（同代时为 Some(prev)，过期时为 None）。
    /// 注意：是否实际写入由 `prev.is_some() || 写入后 get_url == url` 共同判定；
    /// 旧 URL = 新 URL（同 URL 重写）也会被算作"已写入"。调用方用
    /// [`Self::current_generation`] 在锁外再校验一次以决定是否需要 emit 事件。
    pub fn set_url(url: String, generation: u64) -> Option<String> {
        let mut guard = harness_url_slot().lock().ok()?;
        if guard.generation != generation {
            log::warn!(
                target: "dsh",
                "[harness] ignoring stale URL from generation={generation} (current={}): {url}",
                guard.generation,
            );
            return None;
        }
        guard.url.replace(url)
    }

    /// 清空当前 token URL **并 bump generation**：让所有持有旧 generation 的
    /// 输出线程被作废。新进程 spawn 前调用，避免 iframe 仍指向已死进程的 URL。
    /// 返回 bump 后的新 generation（spawn_output_readers 要把它带回写入路径）。
    pub fn bump_generation() -> u64 {
        let mut guard = harness_url_slot().lock().unwrap_or_else(|e| e.into_inner());
        guard.generation = guard.generation.wrapping_add(1);
        guard.url = None;
        guard.generation
    }

    /// 读取当前持有的 dsh token URL；前端 iframe 拿这个地址直接访问。
    pub fn get_url() -> Option<String> {
        harness_url_slot().lock().ok().and_then(|g| g.url.clone())
    }

    /// 读取当前 generation（spawn_output_readers 在 spawn 时记下，set_url 时回传）。
    pub fn current_generation() -> u64 {
        harness_url_slot()
            .lock()
            .map(|g| g.generation)
            .unwrap_or_else(|e| e.into_inner().generation)
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

/// 当前持有的 dsh 实例的本地访问地址（含 token）+ generation 代号。
///
/// 启动新进程时由 [`crate::service::workflow::utils::spawn_output_readers`]
/// 从 stdout 写入；停进程时 [`crate::service::workflow::launch::launch`] /
/// `restart` 调 [`HarnessLifecycle::bump_generation`] 同时清 URL + bump 代号，
/// 让所有旧线程的过期 stdout 写入被丢弃。前端通过
/// [`HarnessLifecycle::URL_EVENT`] 实时接收；`get_runtime_info` /
/// [`HarnessLifecycle::get_url`] 也读这个槽位，确保 fallback 路径
/// （重启早期 / 健康检查未通过）也能拿到最新地址。
#[derive(Default)]
struct UrlSlot {
    url: Option<String>,
    generation: u64,
}

static HARNESS_URL: OnceLock<Mutex<UrlSlot>> = OnceLock::new();

fn harness_url_slot() -> &'static Mutex<UrlSlot> {
    HARNESS_URL.get_or_init(|| Mutex::new(UrlSlot::default()))
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
    use std::sync::Mutex;

    /// 进程内全局测试互斥锁：HARNESS_URL 是跨测试共享的状态，
    /// 必须串行执行避免相邻测试读到对方的 URL / 清掉对方的 URL。
    /// `cargo test` 默认多线程运行，没这个锁的话同一时间会有多个测试操作同一槽位。
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn harness_url_round_trip() {
        let _guard = lock();
        let gen = HarnessLifecycle::bump_generation();
        assert_eq!(HarnessLifecycle::get_url(), None);
        let prev =
            HarnessLifecycle::set_url("http://127.0.0.1:3080/?token=abc".to_string(), gen);
        assert_eq!(prev, None);
        assert_eq!(
            HarnessLifecycle::get_url().as_deref(),
            Some("http://127.0.0.1:3080/?token=abc")
        );
        HarnessLifecycle::bump_generation();
        assert_eq!(HarnessLifecycle::get_url(), None);
    }

    #[test]
    fn harness_url_replaces_previous() {
        let _guard = lock();
        let gen = HarnessLifecycle::bump_generation();
        HarnessLifecycle::set_url("http://127.0.0.1:3080/?token=old".to_string(), gen);
        let prev =
            HarnessLifecycle::set_url("http://127.0.0.1:3081/?token=new".to_string(), gen);
        assert_eq!(prev.as_deref(), Some("http://127.0.0.1:3080/?token=old"));
        assert_eq!(
            HarnessLifecycle::get_url().as_deref(),
            Some("http://127.0.0.1:3081/?token=new")
        );
        HarnessLifecycle::bump_generation();
    }

    #[test]
    fn clear_after_set_resets_to_none() {
        let _guard = lock();
        let gen = HarnessLifecycle::bump_generation();
        HarnessLifecycle::set_url("http://127.0.0.1:3080/?token=x".to_string(), gen);
        HarnessLifecycle::bump_generation();
        assert_eq!(HarnessLifecycle::get_url(), None);
    }

    #[test]
    fn stale_generation_is_ignored() {
        let _guard = lock();
        let old_gen = HarnessLifecycle::bump_generation();
        let new_gen = HarnessLifecycle::bump_generation();
        // 旧 generation 的写入必须被丢弃（restart 后旧线程还在输出）
        let prev = HarnessLifecycle::set_url(
            "http://127.0.0.1:3080/?token=stale".to_string(),
            old_gen,
        );
        assert_eq!(prev, None, "stale generation must not be accepted");
        assert_eq!(HarnessLifecycle::get_url(), None);
        // 同 generation 的写入生效
        let prev = HarnessLifecycle::set_url(
            "http://127.0.0.1:3081/?token=fresh".to_string(),
            new_gen,
        );
        assert_eq!(prev, None);
        assert_eq!(
            HarnessLifecycle::get_url().as_deref(),
            Some("http://127.0.0.1:3081/?token=fresh")
        );
        HarnessLifecycle::bump_generation();
    }

    #[test]
    fn generation_monotonically_increases() {
        let _guard = lock();
        let g1 = HarnessLifecycle::bump_generation();
        let g2 = HarnessLifecycle::bump_generation();
        let g3 = HarnessLifecycle::bump_generation();
        assert!(g2 > g1);
        assert!(g3 > g2);
    }
}