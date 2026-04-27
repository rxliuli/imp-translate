import { useState, useEffect, useRef } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getSettings, saveSettings, type Settings, type TranslationProvider } from '@/lib/storage'
import { LANGUAGES_SORTED } from '@/lib/languages'

const PROVIDERS: { value: TranslationProvider; label: string; description: string }[] = [
  { value: 'microsoft', label: 'Microsoft Translator', description: 'Free, no API key required' },
  { value: 'google', label: 'Google Translate', description: 'Free, no API key required' },
  { value: 'openai', label: 'OpenAI Compatible', description: 'Requires API key' },
]

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${props.className ?? ''}`}
    />
  )
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-20 ${props.className ?? ''}`}
    />
  )
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s)
      loaded.current = true
    })
  }, [])

  useEffect(() => {
    if (!loaded.current || !settings) return
    saveSettings(settings)
  }, [settings])

  if (!settings) return null

  function update(patch: Partial<Settings>) {
    setSettings({ ...settings!, ...patch })
  }

  function updateOpenAI(patch: Partial<Settings['openai']>) {
    setSettings({ ...settings!, openai: { ...settings!.openai, ...patch } })
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Imp Translate Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Basic translation settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Target Language</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={settings.targetLang}
              onChange={(e) => update({ targetLang: e.target.value })}
            >
              {LANGUAGES_SORTED.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Translation Provider</label>
            <div className="space-y-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    settings.provider === p.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={p.value}
                    checked={settings.provider === p.value}
                    onChange={() => update({ provider: p.value })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {settings.provider === 'openai' && (
        <Card>
          <CardHeader>
            <CardTitle>OpenAI Compatible API</CardTitle>
            <CardDescription>
              Configure your OpenAI-compatible API endpoint
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">API Endpoint</label>
              <Input
                type="url"
                value={settings.openai.endpoint}
                onChange={(e) => updateOpenAI({ endpoint: e.target.value })}
                placeholder="https://api.openai.com/v1/chat/completions"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">API Key</label>
              <Input
                type="password"
                value={settings.openai.apiKey}
                onChange={(e) => updateOpenAI({ apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Model</label>
              <Input
                value={settings.openai.model}
                onChange={(e) => updateOpenAI({ model: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">System Prompt</label>
              <Textarea
                value={settings.openai.systemPrompt}
                onChange={(e) => updateOpenAI({ systemPrompt: e.target.value })}
                placeholder="You are a translator..."
              />
              <p className="text-xs text-muted-foreground">
                Use {'{{targetLang}}'} as a placeholder for the target language.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
