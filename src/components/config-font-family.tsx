import type { AppConfig } from '@/hooks/use-app-config'
import { Description, Input, ListBox, Select } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/utils/toast'
import { useAppConfig } from '@/hooks/use-app-config'
import { normalizeFontFamily } from '@/utils/font-family'

export function ConfigFontFamily() {
  const { t } = useTranslation()
  const { data: config, refetch, isFetching } = useAppConfig()
  const [fonts, setFonts] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false
    async function enumerate() {
      try {
        const iterator = (navigator as unknown as { fonts: { query: () => AsyncIterable<{ family: string }> } }).fonts.query()
        const families = new Set<string>()
        for await (const font of iterator) {
          families.add(font.family)
        }
        if (!disposed) {
          setFonts([...families].sort())
          setReady(true)
        }
      }
      catch {
        // Local Font Access API 不可用（不支持 / 权限拒绝）：回退文本输入态
        if (!disposed) {
          setReady(true)
        }
      }
    }
    void enumerate()
    return () => {
      disposed = true
    }
  }, [])

  function postFontToIframe(cssFamily: string) {
    window.dispatchEvent(new CustomEvent('dsh-font-family-change', { detail: cssFamily }))
  }

  const { mutate: setFontFamily, isPending } = useMutation({
    mutationFn: async (fontFamily: string) => {
      const next = normalizeFontFamily(fontFamily)
      await invoke<AppConfig>('update_app_config', { fontFamily: next })
      await refetch()
      postFontToIframe(next)
    },
    onError: (error: unknown) => {
      console.error('[ConfigFontFamily] update failed:', error)
      toast(t('messages.font_family_failed'), { variant: 'danger' })
    },
  })

  const filteredFonts = search
    ? fonts.filter(f => f.toLowerCase().includes(search.toLowerCase()))
    : fonts

  if (!ready) {
    return null
  }

  // Local Font Access API 不可用时回退文本输入态
  if (fonts.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink">{t('ui.font_family')}</span>
          <Input
            variant="secondary"
            value={config?.font_family ?? ''}
            onChange={e => setFontFamily(e.target.value)}
            className="w-[200px]"
            aria-label={t('ui.font_family')}
          />
        </div>
        <Description className="text-[10px] text-muted/70">
          {t('ui.font_family_hint')}
        </Description>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">{t('ui.font_family')}</span>
        <Select
          variant="secondary"
          selectedKey={config?.font_family ?? ''}
          onSelectionChange={key => setFontFamily(String(key))}
          isDisabled={isFetching || isPending}
          className="w-[200px]"
          aria-label={t('ui.font_family')}
        >
          <Select.Trigger className="rounded-md min-h-8! h-8 py-0 items-center">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="rounded-md">
            <ListBox>
              <ListBox.Item className="rounded-md min-h-8!" id="" key="" textValue={t('ui.font_family_default')}>
                {t('ui.font_family_default')}
              </ListBox.Item>
              {filteredFonts.map(family => (
                <ListBox.Item
                  className="rounded-md min-h-8!"
                  id={family}
                  key={family}
                  textValue={family}
                >
                  {family}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div className="mt-1">
        <Input
          variant="secondary"
          placeholder="Search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-[200px]"
          aria-label="Search fonts"
        />
      </div>
      <Description className="text-[10px] text-muted/70">
        {t('ui.font_family_hint')}
      </Description>
    </div>
  )
}
