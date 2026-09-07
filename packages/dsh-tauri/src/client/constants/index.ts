/** 宿主 → iframe 命令的 source。 */
export const SRC_HOST = 'dsh-desktop'

/** iframe → 宿主事件的 source。 */
export const SRC_BRIDGE = 'dsh-nav-bridge'

// ── dsh-tauri invoke 桥（iframe → 宿主 → invoke() → 回传）─────────────
// iframe 内的 dsh 界面 / 插件无法直接访问 `@tauri-apps/api`（`__TAURI_INTERNALS__`
// 只在顶层 webview）。本桥让客户端经 postMessage 把 command 上报到宿主（主
// webview）监听器，由宿主调用 Tauri `invoke` 并把结果回传给 iframe。
/** iframe → 宿主：invoke 请求的 source。 */
export const SRC_INVOKE = 'dsh-tauri-invoke'
/** 宿主 → iframe：invoke 应答的 source。 */
export const SRC_INVOKE_REPLY = 'dsh-desktop-invoke'
/** invoke 请求消息类型。 */
export const TYPE_INVOKE = 'dsh://tauri:invoke'
/** invoke 应答消息类型。 */
export const TYPE_INVOKE_REPLY = 'dsh://tauri:reply'
/** 单次 invoke 等待宿主应答的最长毫秒数（超时按失败处理）。 */
export const INVOKE_TIMEOUT_MS = 15000

/** 宿主命令类型。 */
export const CMD_TOGGLE = 'dsh://sidebar:toggle'
export const CMD_PREV = 'dsh://page:prev'
export const CMD_NEXT = 'dsh://page:next'

/** iframe → 宿主状态事件类型。 */
export const EVENT_SIDEBAR_COLLAPSED = 'dsh://sidebar:collapsed'
export const EVENT_PAGE_FIRSTED = 'dsh://page:firsted'
export const EVENT_PAGE_LASTED = 'dsh://page:lasted'

/** 应用晚挂载时的导航桥探测参数。 */
export const TRACK_MAX_TRIES = 30
export const TRACK_INTERVAL_MS = 500

/** 会话行菜单按钮的 aria-label 模板（zh/en），用于提取标题与按标题找行。 */
export const SESSION_LABEL_PATTERNS = [
  /^会话“(.+)”的操作$/,
  /^Session actions for (.+)$/,
] as const

/** 上报消息的 source key（宿主校验：`source === 'dsh-plugin-error-bridge'`）。 */
export const ERROR_SRC = 'dsh-plugin-error-bridge'

/** 上报消息的 type key（宿主校验：`type === 'dsh://plugin-error'`）。 */
export const ERROR_TYPE = 'dsh://plugin-error'

/** 插件 id（npm 包名）：宿主错误注册表与插件列表的主键。 */
export const PLUGIN_ID = 'dsh-tauri'

/** 客户端插件元数据与生命周期标识。 */
export const PLUGIN_INJECT = ['layout']
export const SIDEBAR_TWEAKS_STYLE_ID = 'dsh-tauri:sidebar-tweaks'
export const SIDEBAR_TWEAKS_EFFECT_ID = 'dsh-tauri: sidebar tweaks (hide collapse toggle, center brand)'
export const NAV_BRIDGE_EFFECT_ID = 'dsh-tauri: nav bridge'

/** 侧边栏稳定 ARIA 选择器。 */
export const COLLAPSE_SIDEBAR_SELECTOR = 'button[aria-label="收起侧边栏"],button[aria-label="Collapse sidebar"]'
export const NEW_SESSION_SELECTOR = 'button[aria-label="新建会话"],button[aria-label="New session"]'
