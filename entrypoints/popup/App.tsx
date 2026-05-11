import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { messager } from '@/lib/message'
import { getSettings, saveSettings, type Settings } from '@/lib/storage'
import { LANGUAGES_SORTED } from '@/lib/languages'
import { LanguagesIcon, SettingsIcon } from 'lucide-react'

async function getActiveTab(): Promise<{ id?: number; url?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return { id: tab?.id, url: tab?.url }
}

function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isTranslated, setIsTranslated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isPdf, setIsPdf] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings)
    getActiveTab().then(async ({ id: tabId, url }) => {
      if (!tabId) return
      if (isPdfUrl(url)) {
        setIsPdf(true)
        return
      }
      const lang = await messager.sendMessage('getTabState', { tabId })
      if (lang) setIsTranslated(true)
    })
  }, [])

  async function handleTranslate() {
    if (!settings) return
    const { id: tabId } = await getActiveTab()
    if (!tabId) return
    setLoading(true)
    try {
      if (isTranslated) {
        await messager.sendMessage('stopTab', { tabId })
        setIsTranslated(false)
      } else {
        await messager.sendMessage('startTab', { tabId, targetLang: settings.targetLang })
        setIsTranslated(true)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleLangChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const targetLang = e.target.value
    const updated = await saveSettings({ targetLang })
    setSettings(updated)
    if (isTranslated) {
      const { id: tabId } = await getActiveTab()
      if (!tabId) return
      await messager.sendMessage('stopTab', { tabId })
      await messager.sendMessage('startTab', { tabId, targetLang })
    }
  }

  function openOptions() {
    browser.runtime.openOptionsPage()
  }

  if (!settings) return null

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
          onChange={handleLangChange}
        >
          {LANGUAGES_SORTED.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {isPdf ? (
        <p className="text-sm text-muted-foreground text-center py-1">
          PDF pages cannot be translated
        </p>
      ) : (
        <Button className="w-full" onClick={handleTranslate} disabled={loading}>
          {loading ? 'Translating...' : isTranslated ? 'Restore Original' : 'Translate Page'}
        </Button>
      )}
    </div>
  )
}
