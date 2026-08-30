//! 注入到内嵌 dsh iframe 的自定义样式桥。
//!
//! 与 [`crate::desktop::nav::NAV_SHIM_JS`] / [`crate::desktop::notification::NOTIFICATION_SHIM_JS`]
//! 走同一套注入通道（Windows 在 FrameCreated → ContentLoading 时 ExecuteScript，
//! 其余平台 `initialization_script_for_all_frames`），因此 iframe 每次重新加载都会重建。
//!
//! 本脚本只负责把一段内置 CSS 以 `<style>` 元素注入 iframe 文档（幂等：按 id 去重）。
//! 具体样式写在下方的 `IFRAME_CSS` 模板字符串里（当前是占位，按需填写/替换即可）。

use serde_json;

/// 动态生成注入 `<style>` 的脚本（带 `__dsh_iframe_styles__` 幂等守卫，重复注入安全）。
///
/// `font_family` 为空字符串时使用占位样式（不覆盖字体）；非空时以 `* !important`
/// 硬覆盖 iframe 全部元素字体。脚本内含 postMessage 运行时更新监听器，
/// 宿主可在设置变更后推送新字体，无需 reload iframe。
pub(crate) fn iframe_styles_js(font_family: &str) -> String {
    let css = if font_family.is_empty() {
        r#".nArs4W_toggleCluster {top:6px !important; right: 6px !important; gap: 2px !important;}
.nArs4W_toggleButton {border-radius: 8px !important;}"#.to_string()
    } else {
        format!(
            r#"*,
            *::before,
            *::after {{
              font-family: "{}" !important;
            }}"#,
            font_family.replace('\\', "\\\\").replace('"', "\\\"")
        )
    };
    let css_json = serde_json::to_string(&css).expect("CSS string is always JSON-serializable");
    format!(r#"(function () {{
      if (window.__dsh_iframe_styles__) return;
      window.__dsh_iframe_styles__ = true;
      var STYLE_ID = 'dsh-desktop-injected-styles';
      var css = JSON.parse({css_json});
      function apply() {{
        if (document.getElementById(STYLE_ID)) return;
        var root = document.head || document.documentElement;
        if (!root) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.type = 'text/css';
        style.textContent = css;
        root.appendChild(style);
      }}
      window.addEventListener('message', function (e) {{
        if (e.source !== window.parent) return;
        if (!e.data || e.data.source !== 'dsh-desktop') return;
        if (e.data.type !== 'dsh://font-family:update') return;
        var s = document.getElementById(STYLE_ID);
        if (s && e.data.css) s.textContent = e.data.css;
      }});
      if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', apply);
      }} else {{
        apply();
      }}
    }})();"#)
}
