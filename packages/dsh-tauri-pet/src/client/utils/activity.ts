import type { SessionLiveActivity } from '../types'
import {
  PET_REASONING_TAIL_LENGTH,
  PET_TOOL_ARGS_MAX_LENGTH,
  SESSION_EVENT_ASSISTANT_CHUNK,
  SESSION_EVENT_ASSISTANT_MESSAGE,
  SESSION_EVENT_CHUNKROW_REASONING,
  SESSION_EVENT_CHUNKROW_TEXT,
  SESSION_EVENT_CHUNKROW_TOOL_CALL,
  SESSION_EVENT_STEP_END,
  SESSION_EVENT_STEP_START,
  SESSION_EVENT_TOOL_CALL,
  SESSION_EVENT_TOOL_RESULT,
  SESSION_EVENT_TURN_END,
  SESSION_EVENT_TURN_START,
  SESSION_EVENT_USER_MESSAGE,
} from '../constants'

/**
 * 会话事件窗口条目（SessionEventLikeEntry，dsh-api-session-controller pageRecords）：
 * `{ type:'event', event: SessionEvent }`（离散事件，供已提交的完整消息/生命周期使用）
 * 与 `{ type:'chunks', event: ChunkRowEvent }`（打包的流式 delta 行）。真正的业务类型
 * 在 event.type，data 在 event.data，两层都只有这几个字段被折叠消费。
 */
interface UnwrappedEvent {
  type: string | undefined
  data: Record<string, unknown>
}

/** 折叠状态机：按时间正序推进，最终状态即「当前正在进行的活动」。 */
type FoldState
  = | { kind: 'none' }
    | { kind: 'reasoning', index: number, text: string }
    | { kind: 'tool', callId: string, name: string, args?: string }
    | { kind: 'text' }

/**
 * 从会话事件窗口（binding.eventSource.getSnapshot().entries，按时间正序）折叠出当前
 * 正在进行的活动：仍在流式输出的思考块（chunkrow/reasoning-chunks 与未打包的
 * reasoning-delta，按块累积、只留尾部）或进行中的工具调用（chunkrow/tool-call-chunks
 * 流式参数，随后 tool/call 权威参数替换，tool/result 关闭）。模型输出正文
 * （text-chunks / assistant/message）不算活动，返回 null 让气泡回落到状态标签。
 *
 * 事件形状对照已安装 dsh 运行时（@deepseek-ai/dsh 0.1.2-rc.1）核实：
 * dsh-session/lib/types/chunk-rows.js（打包行语义 + data.texts/args 增量数组）、
 * dsh-api-session-controller pageRecords / chunkEntryFor（条目信封）、
 * dsh-client-ui-chat 的 rootCall / rootResult fold（tool/call 的 callId/name/arguments、
 * tool/result 的 message.source.callId）。
 */
export function foldSessionActivity(entries: readonly unknown[]): SessionLiveActivity | null {
  let state: FoldState = { kind: 'none' }

  for (const entry of entries) {
    const event = unwrapEntry(entry)
    if (event === undefined || event.type === undefined)
      continue
    const data = event.data

    switch (event.type) {
      // ---- 流式思考（打包行 / 未打包 delta，>=3 与 <3 的块分别走两种信封）----
      case SESSION_EVENT_CHUNKROW_REASONING: {
        const texts = asStringArray(data.texts)
        if (state.kind === 'reasoning' && state.index === data.index)
          state = { kind: 'reasoning', index: state.index, text: appendTail(state.text, texts.join('')) }
        else
          state = { kind: 'reasoning', index: asNumber(data.index, 0), text: appendTail('', texts.join('')) }
        break
      }
      case SESSION_EVENT_ASSISTANT_CHUNK: {
        const chunk = data.chunk
        if (!chunk || typeof chunk !== 'object')
          break
        const block = chunk as Record<string, unknown>
        if (block.type === 'block-start') {
          // 块按顺序开关：新块开始即关闭遗留思考块（异常流的防御，正常流先收到 block-end）；
          // 仅 reasoning 块进入思考态，text/tool-call 块开始视为离开思考
          if (block.blockType === 'reasoning')
            state = { kind: 'reasoning', index: asNumber(block.index, 0), text: '' }
          else
            state = { kind: 'text' }
          break
        }
        if (block.type === 'block-end') {
          if (state.kind === 'reasoning')
            state = { kind: 'none' }
          else if (state.kind === 'text')
            state = { kind: 'none' }
          break
        }
        if (block.type === 'reasoning-delta' && state.kind === 'reasoning' && typeof block.text === 'string') {
          state = { kind: 'reasoning', index: state.index, text: appendTail(state.text, block.text) }
          break
        }
        if (block.type === 'text-delta')
          state = { kind: 'text' }
        break
      }

      // ---- 流式工具调用参数（打包行）：id/name 与逐 token argumentsDelta 数组 ----
      case SESSION_EVENT_CHUNKROW_TOOL_CALL: {
        const args = data.args
        state = {
          kind: 'tool',
          callId: typeof data.id === 'string' ? data.id : '',
          name: typeof data.name === 'string' ? data.name : '',
          args: asStringArray(args).join('').slice(0, PET_TOOL_ARGS_MAX_LENGTH),
        }
        break
      }

      // ---- 离散工具生命周期：tool/call 权威（name + 完整 arguments），tool/result 关闭 ----
      case SESSION_EVENT_TOOL_CALL:
        state = {
          kind: 'tool',
          callId: typeof data.callId === 'string' ? data.callId : '',
          name: typeof data.name === 'string' ? data.name : '',
          args: typeof data.arguments === 'string' ? data.arguments : undefined,
        }
        break
      case SESSION_EVENT_TOOL_RESULT:
        if (state.kind === 'tool')
          state = { kind: 'none' }
        break

      // ---- 正文输出：不算气泡活动 ----
      case SESSION_EVENT_CHUNKROW_TEXT:
      case SESSION_EVENT_ASSISTANT_MESSAGE:
        state = { kind: 'text' }
        break

      // ---- 步/轮/用户边界：清空上一段活动，被中止的调用或中断的思考块不残留展示 ----
      case SESSION_EVENT_STEP_START:
      case SESSION_EVENT_STEP_END:
      case SESSION_EVENT_TURN_START:
      case SESSION_EVENT_TURN_END:
      case SESSION_EVENT_USER_MESSAGE:
        state = { kind: 'none' }
        break
    }
  }

  if (state.kind === 'reasoning' && state.text.length > 0)
    return { kind: 'reasoning', text: state.text }
  if (state.kind === 'tool')
    return { kind: 'tool', name: state.name, args: state.args }
  return null
}

/**
 * 解析窗口条目信封：`{ type:'event'|'chunks', event }` 时取内层 event 的业务类型与 data；
 * 兼容直接传入的裸 SessionEvent（旧窗口/测试），复用同一份 unwrap 便于两种形态互操作。
 */
function unwrapEntry(entry: unknown): UnwrappedEvent | undefined {
  if (entry === null || typeof entry !== 'object')
    return undefined
  const outer = entry as Record<string, unknown>
  const inner = outer.type === 'event' || outer.type === 'chunks' ? outer.event : entry
  if (inner === null || typeof inner !== 'object')
    return undefined
  const record = inner as Record<string, unknown>
  const data = record.data !== null && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  return { type: typeof record.type === 'string' ? record.type : undefined, data }
}

/** data.texts / data.args 的结构化阅读：缺失或非数组视为空串数组（逐 token 增量 join 语义）。 */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 块 index 结构化阅读：非 number 视为 0（单块流无歧义）。 */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

/** 追加思考 delta 并只保留尾部窗口，限制跨窗口传输体积。 */
function appendTail(current: string, delta: string): string {
  if (delta.length === 0)
    return current
  return `${current}${delta}`.slice(-PET_REASONING_TAIL_LENGTH)
}
