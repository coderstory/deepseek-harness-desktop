//! 健康检查（通过 Rust 代理，避免 WebView CORS 问题）。

use std::sync::atomic::Ordering;

use crate::config;

use super::lifecycle::HarnessLifecycle;
use super::process::{has_owned_process, LAUNCH_GUARD};
use super::utils;

/// 无持有进程时应返回给前端的探测信号。
///
/// `launch` 仍在进行（LAUNCH_GUARD 未释放）时，无持有进程是**临时**状态：`launch`
/// 已抢到守卫、尚未把持有进程登记进槽位（spawn 未完成，典型为 auto_start 与前端
/// boot 并发拉起——前端 `launch_harness` 命中“launch already in progress, skipping”
/// 后立刻来探测，此刻 `wait_for_port_release` 可能仍在等待端口回落）。若把这种
/// 临时状态当作 `HARNESS_NOT_OWNED`，前端会命中快速失败分支（`notOwned` → 立即
/// 放弃重试），表现为“首次启动超时、刷新/重试后恢复”。
///
/// 因此 `launch` 仍在进行时返回可重试的“启动中”（`HARNESS_NOT_READY`），让前端
/// 继续轮询；守卫已释放却仍无持有进程，才是真正崩溃/从未拉起（进程随后退出、槽位
/// 被监视线程清空），返回 `HARNESS_NOT_OWNED` 让前端快速失败，避免把“启动即崩溃”
/// 误判成“启动慢”而白白耗完 8 轮重试。
fn not_owned_probe_signal(launch_in_progress: bool) -> &'static str {
    if launch_in_progress {
        "HARNESS_NOT_READY: Harness service is still starting"
    } else {
        "HARNESS_NOT_OWNED: no Harness process is owned by this app"
    }
}

/// 健康检查（通过 Rust 代理，避免 WebView CORS 问题）
///
/// dsh 0.1.2-rc.1+ session auth：
///   1. `GET /?token=…` → 303 + Set-Cookie（reqwest 跟随后 cookie jar 处理在
///      `SameSite=Strict` 下不可靠）
///   2. iframe 端 WebView 自带 cookie jar，跟随 303 → dsh 验签 cookie → 返回
///      index HTML（`<script src="/plugins/??…">`）
///   3. 浏览器拉 `/plugins/??…` 走 cookie 鉴权 → 200 bundle
///
/// 我们这边只验证 step 1 的 boot 页能拿到 2xx——证明 dsh 鉴权链路通了，
/// iframe 自己处理后续 cookie 持久化和 plugin 拉取。逐个探测 plugin URL
/// 在 reqwest 的 `SameSite=Strict` cookie 处理下不可靠（cookie 在重定向时
/// 不一定落到 jar，导致 plugin 探测全 404），跳过这一步让 iframe 接手更稳。
pub async fn proxy_health_check(port: u16) -> Result<String, String> {
    if !has_owned_process() {
        return Err(not_owned_probe_signal(LAUNCH_GUARD.load(Ordering::SeqCst)).to_string());
    }
    // dsh 0.1.2-rc.1+ 在 stdout 输出的 URL 里带 `?token=…`，探测必须带上；
    // 老版本 dsh 或槽位未填充时为 `None`，回退到端口 fallback URL（与之前行为一致）。
    let token = HarnessLifecycle::get_url()
        .as_deref()
        .and_then(HarnessLifecycle::extract_token_from_url);
    let token_ref = token.as_deref();

    let client = utils::loopback_http_client(config::HEALTH_CHECK_TIMEOUT)
        .map_err(|e| format!("HARNESS_HEALTH_CLIENT_FAILED: {e}"))?;
    let root = utils::with_token(
        format!("{}/", config::get_dsh_service_url(port)),
        token_ref,
    );
    let response = client
        .get(&root)
        .send()
        .await
        .map_err(|e| format!("HARNESS_BOOT_MANIFEST_REQUEST_FAILED: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "HARNESS_NOT_READY: boot page returned {status} (probed {root})"
        ));
    }
    log::info!(
        "[Harness] boot page returned {status} (final URL: {}); dsh is serving, deferring plugin check to iframe",
        response.url()
    );
    Ok(format!("healthy - boot page ok ({status})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 回归：无持有进程在“launch 仍在进行”（守卫未释放）时应返回可重试的
    /// `HARNESS_NOT_READY`，而不是把临时状态当成崩溃的 `HARNESS_NOT_OWNED` —
    /// 后者会让前端命中快速失败分支，表现为“首次启动超时、刷新/重试后恢复”。
    #[test]
    fn not_owned_is_retryable_during_launch_not_fatal() {
        // launch 仍在进行（守卫未释放）：无持有进程是启动中的临时状态，前端继续轮询
        assert!(not_owned_probe_signal(true).starts_with("HARNESS_NOT_READY"));
        // 启动已结束（守卫释放）却仍无持有进程：进程已退出/从未拉起 → 快速失败
        assert!(not_owned_probe_signal(false).starts_with("HARNESS_NOT_OWNED"));
    }

    }
