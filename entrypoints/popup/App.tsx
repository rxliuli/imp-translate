import { useState, useEffect } from 'react'
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { messager } from '@/lib/message'
import { getSettings, saveSettings } from '@/lib/storage'
import { LANGUAGES_SORTED } from '@/lib/languages'
import { isPdfUrl } from '@/lib/utils'
import { LanguagesIcon, SettingsIcon } from 'lucide-react'

type TabMeta = { id: number; isPdf: boolean }

// Defined once and reused by useQuery, fetchQuery and invalidateQueries, so a
// key shape or queryFn can't drift between the render path and the action path.
const settingsQuery = queryOptions({
  queryKey: ['settings'] as const,
  queryFn: getSettings,
})

const tabStateQuery = (tab: TabMeta | null) =>
  queryOptions({
    queryKey: ['tabState', tab?.id] as const,
    // `enabled` only gates useQuery — fetchQuery runs the queryFn regardless,
    // so every fetchQuery call below sits behind a resolved, non-PDF tab.
    queryFn: () => messager.sendMessage('getTabState', { tabId: tab!.id }),
    enabled: tab !== null && !tab.isPdf,
  })

export function App() {
  const queryClient = useQueryClient()
  const [tabMeta, setTabMeta] = useState<TabMeta | null>(null)

  // Capture the active tab once when popup opens (it's tied to this tab)
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) return
      setTabMeta({ id: tab.id, isPdf: isPdfUrl(tab.url) })
    })
  }, [])

  // Settings — always fresh, no stale closure issues
  const { data: settings } = useQuery(settingsQuery)

  // Tab translation state — the query is disabled until tabMeta resolves
  const { data: tabLang } = useQuery(tabStateQuery(tabMeta))

  const isTranslated = tabLang !== null

  // Toggle translate / restore — reads latest state via queryClient, not closure
  const toggleMutation = useMutation({
    mutationFn: async () => {
      const tabId = tabMeta!.id
      const currentLang = await queryClient.fetchQuery(tabStateQuery(tabMeta))
      if (currentLang) {
        await messager.sendMessage('stopTab', { tabId })
      } else {
        const lang = (await queryClient.fetchQuery(settingsQuery)).targetLang
        await messager.sendMessage('startTab', { tabId, targetLang: lang })
      }
    },
    onSuccess: () => {
      if (tabMeta) {
        queryClient.invalidateQueries({ queryKey: tabStateQuery(tabMeta).queryKey })
      }
    },
  })

  // Language change — always reads fresh state before deciding what to do
  const langChangeMutation = useMutation({
    mutationFn: async (newLang: string) => {
      const updated = await saveSettings({ targetLang: newLang })
      if (tabMeta && !tabMeta.isPdf) {
        const currentLang = await queryClient.fetchQuery(tabStateQuery(tabMeta))
        if (currentLang) {
          await messager.sendMessage('stopTab', { tabId: tabMeta.id })
          await messager.sendMessage('startTab', { tabId: tabMeta.id, targetLang: newLang })
        }
      }
      return updated
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsQuery.queryKey, updated)
      if (tabMeta) {
        queryClient.invalidateQueries({ queryKey: tabStateQuery(tabMeta).queryKey })
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
