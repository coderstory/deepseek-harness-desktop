/**
 * src/index.ts — dsh-tauri-pet 宿主侧（node half）。
 *
 * 桌宠能力全部在浏览器 half（shell.overlay 浮控件经 invoke 桥调用桌面端 Rust
 * 命令），宿主无需注册任何 Node 行为；loader 按行名导入包根时需要一个可挂载的
 * 插件入口，这里给一个空 apply。
 */

/** 插件名（诊断元数据）。 */
export const name = 'dsh-tauri-pet'

/** 需要的宿主服务（无，纯客户端能力）。 */
export const inject: string[] = []

/** 插件体：无宿主行为。 */
export function apply(): void {}
