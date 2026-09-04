//! Harness 服务进程生命周期编排（workflow）。
//!
//! 公开入口：[**`HarnessLifecycle`**](lifecycle) — 启动 / 关闭 / 重启 / 健康检查
//! 与 token URL 槽位都从这一个 struct 调，不再跨子模块拼装。
//!
//! 子模块划分（全部 `pub(super)`，只对 [`lifecycle`] 可见）：
//! - [`launch`]：start / launch / restart 编排（端口自愈、`--no-open` 版本判定、
//!   补丁挂点、Windows 隐藏控制台启动、token URL 解析入口）
//! - [`process`]：本应用持有的 Harness 根进程登记（PID + Windows 句柄成对）、
//!   启动守卫、停止/退出回收、进程树终止与按 dsh 安装路径清扫历史残留
//! - [`utils`]：stdout 读取 + token URL 正则解析（写 [`HarnessLifecycle::set_url`]）
//! - [`sweep`]：孤儿 Harness 清扫（`.harness.pid` + 端口/PID 双重确认）与
//!   Windows RedirectionGuard(448) 逃逸重拉
//! - [`health`]：健康检查（Rust 代理，避免 WebView CORS 问题）
//! - [`install`]：安装环境（Node.js 运行时 + Harness 发行版 + pnpm + MinGit）
//!
//! 仍对外保留的子模块：
//! - [`status`]：状态子系统（set_status / get_status / emit_status），独立于生命周期

pub mod lifecycle;
pub mod status;

pub(crate) mod win_inspector;
#[cfg(windows)]
pub(crate) mod win_spawn;

mod health;
mod install;
mod launch;
mod process;
mod sweep;
mod utils;

pub use lifecycle::HarnessLifecycle;

#[doc(inline)]
pub use install::install;
