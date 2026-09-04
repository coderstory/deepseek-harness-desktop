# dsh-tauri-pet

DeepSeek Harness 的桌宠插件。它在设置页提供 `Pets` 与 `Codex` 两个页签，
并通过 `dsh-tauri` 的 Tauri invoke 桥控制独立的透明、置顶、无边框桌宠窗口。

## UI

- **Pets**：显示内置 `Maid DeepSeek Whale` 以及 Chat 来源的宠物卡片；工具栏提供
  **Create** 和 **Wake pet / Collapse pet**。`Create` 创建标准会话并只预填
  `/hatch-dsh-pet 根据你对我的了解，养一只宠物`，不会自动提交。
- **Codex**：显示 Codex 来源（`~/.codex/pets`）的宠物卡片；工具栏只有
  **Import**，用于导入 `.zip` 资源包。
- 内置宠物的中文描述为：
  `一只小小的七比蓝头发的鲸鱼女仆Codex宠物，穿着海军蓝裙子，白色褶边，蓝眼睛，侧鳍和鲸鱼尾巴。`
- 宠物大小滑条保持 50–200%，默认 100%。侧栏绿色圆点表示窗口当前 **visible** 状态，
  而不是只表示持久化的 `enabled` 状态。首次点击会永久启用；之后只显示或隐藏窗口，
  不会因隐藏而写入 `enabled=false`。

## 文件来源与技能

Chat 宠物安装在 `${DSH_HOME:-$HOME/.dsh}/pets`，Codex 宠物安装在
`$HOME/.codex/pets`，两个来源通过 `list_pets({ source: 'chat' | 'codex' })`
严格分开。`skills/hatch-dsh-pet/SKILL.md` 由 `cordis.patch.yml` 组合进
`@deepseek-ai/dsh-skill-filesystem`，并使用 `providerName: dsh-tauri-pet` 与
`includeDefaultRoots: false`，避免覆盖其他 skill provider 或默认根目录。

## Bridge commands

| command | 说明 |
| --- | --- |
| `get_pet_status` | 查询 `enabled`、`visible`、`active_pet`、`pet_size` 与瞬态 activity |
| `set_pet_enabled` | 持久化首次启用；启用时显示窗口 |
| `show_pet` / `hide_pet` | 只改变窗口可见性，不改变持久化 enabled |
| `set_active_pet` | 持久化选择的宠物 id |
| `set_pet_size` | 持久化 50–200% 的大小 |
| `list_pets` | 按 `source` 列出 Chat 或 Codex 宠物 |
| `get_pet_asset` | 获取指定宠物的完整 8×11 spritesheet data URL |
| `import_pet` | 导入 Codex `.zip` 资源包 |
| `set_pet_activity` | 更新 `idle`、`turn`、`moving-left`、`moving-right`、`waving`、`waiting`、`running`、`review` 或 `failed` |

完整客户端桥实现见 `src/client/service/pet.ts`；它调用
`dsh-tauri/client` 的 `invokeBridgedTauri`。设置卡片会将完整 spritesheet 裁剪为
首个 idle cell 预览，而内置 GIF 直接作为动画预览。

## Build and checks

```sh
pnpm --filter dsh-tauri-pet typecheck
pnpm --filter dsh-tauri-pet build
pnpm exec eslint packages/dsh-tauri-pet/src/client --max-warnings=0
pnpm exec vitest run packages/dsh-tauri-pet/src/client/utils/activity.test.ts
```
