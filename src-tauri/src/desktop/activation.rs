//! macOS activation policy（应用级前台形态）切换。
//!
//! 窗口隐藏时切 `.accessory` 让 Dock 图标消失，恢复时切回 `.regular` 让 Dock
//! 图标与菜单栏同步出现。策略是**应用级**状态而非窗口级，一次切换对全部屏幕的
//! Dock 一并生效，因此本模块不做任何窗口级/屏幕级判断（多显示器无需特殊处理）。
//!
//! 关于 Cmd+Tab：本模块**不为 Cmd+Tab 留任何钩子**。`.accessory` 会把应用同时
//! 从 Dock 与 ⌘-Tab 切换器移除，且 `tauri::RunEvent` 没有 app-activate 事件可挂
//! （D-18 取代 D-06 与 D-13 的 Cmd+Tab 部分）。驻留期间的前台恢复路径只有：
//! 托盘左键 / 托盘菜单「打开面板」/ `RunEvent::Reopen`（启动台·Spotlight）/
//! release single-instance。

/// 关闭窗口 = 隐藏到托盘（D-09 默认值，也是本阶段 CloseRequested 唯一传入的动作）。
pub const CLOSE_ACTION_TRAY: &str = "tray";

/// 关闭窗口 = 退出应用。
pub const CLOSE_ACTION_QUIT: &str = "quit";

#[cfg(test)]
mod tests {
    use super::{should_switch_to_accessory, CLOSE_ACTION_QUIT, CLOSE_ACTION_TRAY};

    #[test]
    fn close_action_constants_match_store_values() {
        assert_eq!(CLOSE_ACTION_TRAY, "tray", "托盘驻留动作必须是 tray");
        assert_eq!(CLOSE_ACTION_QUIT, "quit", "退出动作必须是 quit");
    }

    #[test]
    fn closes_to_tray_hides_dock_when_not_fullscreen() {
        assert!(
            should_switch_to_accessory(false, CLOSE_ACTION_TRAY),
            "普通关窗应当切 Accessory 隐藏 Dock"
        );
    }

    #[test]
    fn fullscreen_close_keeps_dock_until_exit_fullscreen() {
        assert!(
            !should_switch_to_accessory(true, CLOSE_ACTION_TRAY),
            "全屏态关窗必须保持 regular，退出全屏后再补切"
        );
    }

    #[test]
    fn quit_action_never_switches_policy() {
        assert!(
            !should_switch_to_accessory(false, CLOSE_ACTION_QUIT),
            "要退出的关窗不需要切 Accessory"
        );
        assert!(
            !should_switch_to_accessory(true, CLOSE_ACTION_QUIT),
            "全屏且要退出时同样不切 Accessory"
        );
    }

    #[test]
    fn unknown_close_action_keeps_dock_visible() {
        assert!(
            !should_switch_to_accessory(false, ""),
            "空动作应保守降级为不切，Dock 保留"
        );
        assert!(
            !should_switch_to_accessory(false, "TRAY"),
            "大小写不一致的动作不识别，Dock 保留"
        );
        assert!(
            !should_switch_to_accessory(false, "bogus"),
            "未知动作应保守降级为不切，Dock 保留"
        );
    }
}
