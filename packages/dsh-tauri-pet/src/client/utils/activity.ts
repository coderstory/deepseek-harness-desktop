import type { PetSessionActivity, PetSessionSnapshot, PetSessionSummary } from '../types'
import { PET_ACTIVITY_BUBBLE_MAX } from '../constants'

/** Map the Codex reference precedence to the desktop animation protocol. */
export function mapPetActivity(
  summary: PetSessionSummary | undefined,
  session: PetSessionSnapshot | undefined,
  pendingInteraction: unknown,
): PetSessionActivity {
  if (pendingInteraction !== undefined)
    return 'waiting'
  if (summary?.running === true || session?.running === true)
    return 'running'
  if (summary?.completed === true)
    return 'review'
  if (session?.lastAgentError !== null && session?.lastAgentError !== undefined)
    return 'failed'
  return 'idle'
}

export function activityBubble(activity: PetSessionActivity, label: string, title?: string): string | undefined {
  if (activity === 'idle')
    return undefined
  const message = title ? `${label}: ${title}` : label
  return Array.from(message).slice(0, PET_ACTIVITY_BUBBLE_MAX).join('')
}
