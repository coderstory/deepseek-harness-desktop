import { useWatch } from '@hairy/react-lib'
import { useStore } from 'valtio-define'
import { useCoreBreakingConfirm } from '@/hooks/use-core-breaking-confirm'
import { store } from '@/store'

/** 右下角“发现新版本”提示条：状态与操作直接来自 updater store */
export function HarnessUpdater() {
  const { updateInfo, updating } = useStore(store.harnessUpdater)
  const { holder, confirmCoreBreaking } = useCoreBreakingConfirm()

  useWatch([updateInfo, updating], () => {
    if (!updateInfo || updating)
      return
    // 仅提示新版本，不打断用户；破坏性更改确认推迟到点击「立即更新」时（见 handleUpdate）
    store.harnessUpdater.showToast(() => handleUpdate())
  }, { immediate: true })

  /** 点击「立即更新」：目标版本高于 rc.2 时先弹破坏性更改确认，取消则中止更新 */
  async function handleUpdate() {
    const info = store.harnessUpdater.updateInfo
    if (!info || !(await confirmCoreBreaking(info.tag)))
      return
    await store.harnessUpdater.handleUpdate()
  }

  return holder
}
