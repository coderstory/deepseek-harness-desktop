/** 宿主命令所需的业务面（由插件体注入 ctx.layout）。 */
export interface NavBridgeHandlers {
  toggleSidebar: () => void
}

/** 会话访问栈中的页面。 */
export interface Page {
  key: string | null
  el: HTMLElement | null
}

/** 记录动作（与宿主 `PluginError.action` 语义一致）。 */
export type ErrorAction = 'runtime' | 'install' | 'update' | 'remove'

// ── dsh-tauri invoke 桥（iframe → 宿主 → invoke()）────────────────
/** iframe → 宿主 的 invoke 请求（postMessage）。 */
export interface InvokeBridgeRequest {
  source: 'dsh-tauri-invoke'
  type: 'dsh://tauri:invoke'
  /** Tauri command 名。 */
  cmd: string
  /** command 参数对象。 */
  args?: Record<string, unknown>
  /** 一次请求的唯一标识，宿主原样回填用于匹配。 */
  nonce: string
}

/** 宿主 → iframe 的 invoke 应答（postMessage）。 */
export interface InvokeBridgeReply {
  source: 'dsh-desktop-invoke'
  type: 'dsh://tauri:reply'
  nonce: string
  /** true=成功（value 有效）；false=失败（error 为 command 抛出的字符串）。 */
  ok: boolean
  value?: unknown
  error?: string
}
