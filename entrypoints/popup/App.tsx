import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { messager } from '@/lib/message'
import { getSettings, saveSettings, type Settings } from '@/lib/storage'
import { LANGUAGES_SORTED } from '@/lib/languages'
import { LanguagesIcon, SettingsIcon } from 'lucide-react'

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isTranslated, setIsTranslated] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings)
    getActiveTabId().then(async (tabId) => {
      if (!tabId) return
      const lang = await messager.sendMessage('getTabState', { tabId })
      if (lang) setIsTranslated(true)
    })
  }, [])

  async function handleTranslate() {
    if (!settings) return
    const tabId = await getActiveTabId()
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
      const tabId = await getActiveTabId()
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

      <Button className="w-full" onClick={handleTranslate} disabled={loading}>
        {loading ? 'Translating...' : isTranslated ? 'Restore Original' : 'Translate Page'}
      </Button>
    </div>
  )
}
