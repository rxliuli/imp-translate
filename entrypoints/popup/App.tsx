import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { messager } from '@/lib/message'
import { getSettings, saveSettings } from '@/lib/storage'
import { LANGUAGES_SORTED } from '@/lib/languages'
import { LanguagesIcon, SettingsIcon } from 'lucide-react'

function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

const settingsQuery = {
  queryKey: ['settings'] as const,
  queryFn: getSettings,
}

function tabStateQuery(tabId: number) {
  return {
    queryKey: ['tabState', tabId] as const,
    queryFn: () => messager.sendMessage('getTabState', { tabId }),
  }
}

export function App() {
  const queryClient = useQueryClient()
  const [tabMeta, setTabMeta] = useState<{ id: number; isPdf: boolean } | null>(null)

  // Capture the active tab once when popup opens (it's tied to this tab)
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) return
      setTabMeta({ id: tab.id, isPdf: isPdfUrl(tab.url) })
    })
  }, [])

  // Settings — always fresh, no stale closure issues
  const { data: settings } = useQuery(settingsQuery)

  // Tab translation state — disabled until tabMeta is resolved
  // queryKey includes tabMeta?.id (undefined → null at mount) so the key is
  // stable across renders; enabled guard prevents actual execution.
  const { data: tabLang } = useQuery({
    queryKey: ['tabState', tabMeta?.id],
    queryFn: () => messager.sendMessage('getTabState', { tabId: tabMeta!.id }),
    enabled: tabMeta !== null && !tabMeta.isPdf,
  })

  const isTranslated = tabLang !== null

  // Toggle translate / restore — reads latest state via queryClient, not closure
  const toggleMutation = useMutation({
    mutationFn: async () => {
      const tabId = tabMeta!.id
      const currentLang = await queryClient.fetchQuery(tabStateQuery(tabId))
      if (currentLang) {
        await messager.sendMessage('stopTab', { tabId })
      } else {
        const lang = (await queryClient.fetchQuery(settingsQuery)).targetLang
        await messager.sendMessage('startTab', { tabId, targetLang: lang })
      }
    },
    onSuccess: () => {
      if (tabMeta) {
        queryClient.invalidateQueries({ queryKey: ['tabState', tabMeta.id] })
      }
    },
  })

  // Language change — always reads fresh state before deciding what to do
  const langChangeMutation = useMutation({
    mutationFn: async (newLang: string) => {
      const updated = await saveSettings({ targetLang: newLang })
      if (tabMeta && !tabMeta.isPdf) {
        const currentLang = await queryClient.fetchQuery(tabStateQuery(tabMeta.id))
        if (currentLang) {
          await messager.sendMessage('stopTab', { tabId: tabMeta.id })
          await messager.sendMessage('startTab', { tabId: tabMeta.id, targetLang: newLang })
        }
      }
      return updated
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated)
      if (tabMeta) {
        queryClient.invalidateQueries({ queryKey: ['tabState', tabMeta.id] })
      }
    },
  })

  function openOptions() {
    browser.runtime.openOptionsPage()
  }

  if (!settings || !tabMeta) return null

  return (
    <div className="min-w-72 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold flex items-center gap-1.5">
          <LanguagesIcon className="w-4 h-4" />
          Imp Translate
        </h1>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openOptions}>
          <SettingsIcon className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">Target Language</label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          value={settings.targetLang}
          onChange={(e) => langChangeMutation.mutate(e.target.value)}
        >
          {LANGUAGES_SORTED.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {tabMeta.isPdf ? (
        <p className="text-sm text-muted-foreground text-center py-1">
          PDF pages cannot be translated
        </p>
      ) : (
        <Button
          className="w-full"
          onClick={() => toggleMutation.mutate()}
          disabled={toggleMutation.isPending || langChangeMutation.isPending}
        >
          {toggleMutation.isPending
            ? 'Translating...'
            : isTranslated
              ? 'Restore Original'
              : 'Translate Page'}
        </Button>
      )}
    </div>
  )
}
