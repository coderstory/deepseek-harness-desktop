/** Shared client types for the pet settings, bridge, and session activity. */
export type PetActivity = 'failed' | 'idle' | 'moving-left' | 'moving-right' | 'review' | 'running' | 'turn' | 'waiting' | 'waving'

/** Session states selected by the activity adapter before native animation details. */
export type PetSessionActivity = Extract<PetActivity, 'failed' | 'idle' | 'review' | 'running' | 'waiting'>

export interface PetStatus {
  active_pet: string
  activity: PetActivity
  bubble?: string | null
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

export interface PetSessionSummary {
  completed?: boolean
  displayTitle?: string
  id: string
  pendingInteraction?: unknown
  running?: boolean
  title?: string
}

export interface PetSessionSnapshot {
  awaitingFirstTurn?: boolean
  lastAgentError?: string | null
  pendingSubmissions?: readonly unknown[]
  queue?: readonly unknown[]
  running?: boolean
}

export interface PetObservable<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

export interface PetSessionsRuntime {
  binding?: (id: string) => {
    session?: PetObservable<PetSessionSnapshot>
  } | undefined
  list: PetObservable<{
    byId?: Record<string, PetSessionSummary>
    current?: string
    ids: string[]
  }>
  open?: (id: string) => void
}

export interface WorkspaceItem {
  id?: string
  sessionIds?: readonly string[]
  workspaceId?: string
}

export interface PetRuntimeContext {
  sessions: PetSessionsRuntime
  uiSession?: {
    pendingInteractions?: PetObservable<ReadonlyMap<string, unknown>>
  }
  workspaces: {
    connectWorkspace?: (id: string) => Promise<string>
    list: PetObservable<{
      items?: WorkspaceItem[]
      recentWorkspaceId?: string
    }>
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
  = | 'activityFailed'
    | 'activityIdle'
    | 'activityReview'
    | 'activityRunning'
    | 'activityWaiting'
    | 'codex'
    | 'collapsePet'
    | 'create'
    | 'createFailed'
    | 'emptyImported'
    | 'import'
    | 'importFailed'
    | 'listFailed'
    | 'name'
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
