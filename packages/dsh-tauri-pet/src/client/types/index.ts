/** Shared client types for pet settings and raw session forwarding. */
export interface PetStatus {
  active_pet: string
  enabled: boolean
  pet_size?: number | null
  visible: boolean
}

export type PetSource = 'chat' | 'codex'

export interface PetListItem {
  description?: string
  id: string
  name: string
  source: PetSource
  thumbnail?: string
}

export interface PetAsset {
  columns: number
  id: string
  rows: number
  sprite_version_number: number
  spritesheet: string
}

/** 预设宠物清单条目（`resources/preset-pets.json` 的展示层投影）。 */
export interface PresetPetItem {
  desc?: string | null
  id: string
  image?: string | null
  installed: boolean
  name: string
  size_mb?: number | null
  /** 当前下载阶段（idle|downloading|extracting|done|failed），跨挂载恢复下载中视图用。 */
  phase?: PresetDownloadProgress['phase'] | null
}

/** 预设宠物下载进度快照（设置页轮询 `get_preset_download_progress`）。 */
export interface PresetDownloadProgress {
  phase: 'idle' | 'downloading' | 'extracting' | 'done' | 'failed'
  received: number
  total: number
  error?: string | null
}

export interface WorkspaceItem {
  id?: string
  sessionIds?: readonly string[]
  workspaceId?: string
}

/**
 * 会话实时活动：dsh-tauri-pet 从会话事件窗口（binding.eventSource）折叠，随会话
 * 快照以 liveActivity 字段推送给桌宠窗口；无活动时为 null，会话无事件窗口
 * （alpha 运行时）则整个字段缺席。展示端把 kind=tool 的 name/args 映射为
 * 「Pwsh · 命令 / 编辑 · 文件 / 工具调用 · 工具名」，kind=reasoning 映射为「思考 · 文本」。
 */
export interface SessionLiveActivity {
  kind: 'reasoning' | 'tool'
  /** kind=reasoning：思考块文本尾部（最新的思考内容） */
  text?: string
  /** kind=tool：工具注册名（pwsh / bash / str_replace_editor / read …） */
  name?: string
  /** kind=tool：模型输出的原始 arguments JSON 串，由展示端按工具提取细节 */
  args?: string
}

export interface PetRuntimeContext {
  sessions: {
    list: {
      getSnapshot: () => {
        current?: string
        ids: readonly string[]
      }
    }
    open?: (id: string) => void
  }
  workspaces: {
    connectWorkspace?: (id: string) => Promise<string>
    list: {
      getSnapshot: () => {
        items?: WorkspaceItem[]
        recentWorkspaceId?: string
      }
    }
  }
}

export interface PetSettingsProps {
  close?: () => void
  onCreate: (close?: () => void) => Promise<void>
}

export interface ConversationInputLeftProps {
  inputActions: {
    setDraft: (text: string) => void
  }
  sessionId: string
}

export type LocaleKey
  = | 'codex'
    | 'collapsePet'
    | 'create'
    | 'createFailed'
    | 'download'
    | 'downloadFailed'
    | 'downloading'
    | 'emptyImported'
    | 'enable'
    | 'import'
    | 'importFailed'
    | 'listFailed'
    | 'loading'
    | 'name'

    | 'noPetSelected'
    | 'petDescWhale'
    | 'petNameWhale'
    | 'select'
    | 'selected'
    | 'setPetFailed'
    | 'setSizeFailed'
    | 'sizeHint'
    | 'sizeLabel'
    | 'tabCodexDesc'
    | 'tabInstalledDesc'
    | 'toggleFailed'
    | 'wakePet'
