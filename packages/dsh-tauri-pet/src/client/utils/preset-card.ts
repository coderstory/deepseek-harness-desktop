import type { PresetDownloadProgress, PresetPetItem } from '../types'

/**
 * 预设宠物卡片右侧动作的纯状态机。
 *
 * 优先级：已选（selected）> 下载/解压中（downloading）> 已安装（enable）>
 * 未安装（download）。与设置页 `presetCardAction` 一一对应。
 *
 * 下载中状态有两个来源：`progress.phase`（进行中的轮询快照）与 `item.phase`
 * （`list_preset_pets` 返回的进程内注册表阶段，跨挂载恢复下载中视图用——组件
 * 卸载后重进设置页时，轮询未启动、`progress` 为 null，但清单已带 phase）。
 */
export function resolvePresetCardAction(
  item: Pick<PresetPetItem, 'id' | 'installed' | 'phase'>,
  active: string,
  progress: PresetDownloadProgress | null | undefined,
): 'download' | 'downloading' | 'enable' | 'selected' {
  if (item.id === active)
    return 'selected'
  const phase = progress?.phase ?? item.phase
  if (phase === 'downloading' || phase === 'extracting')
    return 'downloading'
  if (item.installed)
    return 'enable'
  return 'download'
}

/** 把下载进度渲染成百分比；未知总量（下载早期/解压中）返回 null 表示不确定进度。 */
export function progressPercent(progress: PresetDownloadProgress): number | null {
  if (progress.total > 0)
    return Math.min(100, Math.round((progress.received / progress.total) * 100))
  return progress.phase === 'extracting' || progress.phase === 'downloading' ? null : 0
}
