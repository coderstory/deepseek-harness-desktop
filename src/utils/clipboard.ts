import { invoke } from '@tauri-apps/api/core'

/**
 * 把纯文本写入系统剪贴板。
 *
 * 走原生 `write_clipboard_text` 命令（`bridge::clipboard`），而不再用
 * `@tauri-apps/plugin-clipboard-manager`：后者在应用启动时于主线程创建并持有单例
 * `arboard::Clipboard`，在 Linux Wayland 合成器不支持 `ext-data-control`/
 * `wlr-data-control` 时会导致「复制运行日志」崩溃/挂死。原生命令按次在
 * `spawn_blocking` 中惰性新建短期剪贴板句柄，用完即弃，规避该崩溃。
 */
export function writeClipboardText(text: string): Promise<void> {
  return invoke<void>('write_clipboard_text', { text })
}
