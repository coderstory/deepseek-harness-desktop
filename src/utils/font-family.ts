export const FONT_FAMILY_DEFAULT = ''

// 前端归一化：trim + 拒绝 CSS 元字符（与后端 normalize_font_family 对齐）。
// 空值 = 使用系统默认（不注入覆盖）。
export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== 'string')
    return FONT_FAMILY_DEFAULT
  const trimmed = value.trim()
  if (!trimmed)
    return FONT_FAMILY_DEFAULT
  const forbidden = /[{}();<>\\_]/
  if (forbidden.test(trimmed))
    return FONT_FAMILY_DEFAULT
  return trimmed
}
