/** Stable client protocol identifiers and shared UI defaults for dsh-tauri-pet. */
export const PET_CLIENT_PLUGIN = 'dsh-tauri-pet'
export const PET_SECTION_ID = 'dsh-tauri-pet-settings'
export const PET_SECTION_ORDER = 230
export const PET_STYLES_EFFECT = 'dsh-tauri-pet: styles'
export const PET_SECTION_EFFECT = 'dsh-tauri-pet: settings section'
export const PET_ICON_PATCH_EFFECT = 'dsh-tauri-pet: sidebar icon patch'
export const PET_PREFILL_EFFECT = 'dsh-tauri-pet: conversation prefill'
export const PET_CLIENT_NS = 'dsh-tauri-pet'
export const CONVERSATION_INPUT_LEFT_SLOT = 'conversation.input.left'
export const PET_PREFILL_ID = 'dsh-tauri-pet-prefill'
export const PET_PREFILL_ORDER = 230
export const PET_PREFILL_PRIORITY = 0
export const PET_HATCH_PROMPT = '/hatch-dsh-pet 根据你对我的了解，养一只宠物'
export const CMD_GET_PET_STATUS = 'get_pet_status'
export const CMD_SET_PET_ENABLED = 'set_pet_enabled'
export const CMD_SET_ACTIVE_PET = 'set_active_pet'
export const CMD_SET_PET_SIZE = 'set_pet_size'
export const CMD_SHOW_PET = 'show_pet'
export const CMD_HIDE_PET = 'hide_pet'
export const CMD_LIST_PETS = 'list_pets'
export const CMD_IMPORT_PET = 'import_pet'
export const CMD_PUSH_PET_SESSION = 'push_pet_session'
export const CMD_GET_PET_ASSET = 'get_pet_asset'
export const CMD_LIST_PRESET_PETS = 'list_preset_pets'
export const CMD_DOWNLOAD_PRESET_PET = 'download_preset_pet'
export const CMD_GET_PRESET_DOWNLOAD_PROGRESS = 'get_preset_download_progress'
export const BUILTIN_PET_ID = 'maid-deepseek-whale'
export const BUILTIN_PET_NAME = 'Maid DeepSeek Whale'
export const BUILTIN_PET_DESC_ZH = '一只小小的七比蓝头发的鲸鱼女仆Codex宠物，穿着海军蓝裙子，白色褶边，蓝眼睛，侧鳍和鲸鱼尾巴。'
export const BUILTIN_PET_DESC_EN = 'A tiny blue-haired whale maid Codex pet in a navy dress with white ruffles, blue eyes, side fins, and a whale tail.'
export const DEFAULT_PETS = [{ id: BUILTIN_PET_ID, label: BUILTIN_PET_NAME }] as const
export const SIDEBAR_SELECTOR = '[data-slot="sidebar"]'
export const SETTINGS_TRIGGER_SELECTOR = '.dsh-tu-settingsTrigger'
export const PET_ICON_ATTRIBUTE = 'data-dsh-tauri-pet-icon'
export const PET_SETTINGS_ROW_CLASS = 'dshpet-settingsRow'
export const PET_ICON_RETRY_MS = 500
export const PET_ICON_RETRY_MAX = 30
export const PET_DEFAULT_SIZE = 100
export const PET_SIZE_MIN = 50
export const PET_SIZE_MAX = 200
export const PET_SIZE_STEP = 5

/** 实时活动折叠：流式 delta 事件逐 token 触发，按会话做 trailing 节流合并推送。 */
export const PET_ACTIVITY_THROTTLE_MS = 300
/** 思考文本只保留尾部窗口：展示「最新思考内容」，同时限制跨窗口传输体积。 */
export const PET_REASONING_TAIL_LENGTH = 160
/** 流式累积的工具参数最大长度：tool/call 离散事件随后会携带完整 arguments 替换，截断只影响 streaming 期间的一瞬展示。 */
export const PET_TOOL_ARGS_MAX_LENGTH = 2000

/**
 * dsh 会话事件词汇表（@deepseek-ai/dsh-session KNOWN_SESSION_EVENT_TYPES）中实时活动
 * 折叠用到的类型。窗口条目有两种信封：{ type:'event', event: SessionEvent }（离散事件，
 * 事件类型即 SESSION_EVENT_*）与 { type:'chunks', event: ChunkRowEvent }（打包的流式
 * delta 行，类型即 SESSION_EVENT_CHUNKROW_*，data.texts/args 为逐 token 增量数组）。
 */
export const SESSION_EVENT_ASSISTANT_CHUNK = 'assistant/chunk'
export const SESSION_EVENT_ASSISTANT_MESSAGE = 'assistant/message'
export const SESSION_EVENT_TOOL_CALL = 'tool/call'
export const SESSION_EVENT_TOOL_RESULT = 'tool/result'
export const SESSION_EVENT_STEP_START = 'step/start'
export const SESSION_EVENT_STEP_END = 'step/end'
export const SESSION_EVENT_TURN_START = 'turn/start'
export const SESSION_EVENT_TURN_END = 'turn/end'
export const SESSION_EVENT_USER_MESSAGE = 'user/message'
export const SESSION_EVENT_CHUNKROW_TEXT = 'chunkrow/text-chunks'
export const SESSION_EVENT_CHUNKROW_REASONING = 'chunkrow/reasoning-chunks'
export const SESSION_EVENT_CHUNKROW_TOOL_CALL = 'chunkrow/tool-call-chunks'
