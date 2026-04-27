import { useState, useEffect, useRef } from 'react'
import { getSettings, saveSettings, type Settings, type TranslationProvider } from '@/lib/storage'
import { LANGUAGES_SORTED } from '@/lib/languages'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PROVIDERS: { value: TranslationProvider; label: string; description: string }[] = [
  { value: 'microsoft', label: 'Microsoft Translator', description: 'Free, no API key required' },
  { value: 'google', label: 'Google Translate', description: 'Free, no API key required' },
  { value: 'openai', label: 'OpenAI Compatible', description: 'Requires API key' },
]

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
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-bold">Imp Translate</h1>

      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label>Target Language</Label>
          <Select value={settings.targetLang} onValueChange={(v) => update({ targetLang: v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-60">
              {LANGUAGES_SORTED.map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Translation Provider</Label>
          <RadioGroup
            value={settings.provider}
            onValueChange={(v) => update({ provider: v as TranslationProvider })}
          >
            {PROVIDERS.map((p) => (
              <label
                key={p.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  settings.provider === p.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <RadioGroupItem value={p.value} className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>
      </section>

      {settings.provider === 'openai' && (
        <section className="space-y-4">
          <div>
            <h2 className="font-semibold">OpenAI Compatible API</h2>
            <p className="text-sm text-muted-foreground">
              Configure your OpenAI-compatible API endpoint
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>API Endpoint</Label>
            <Input
              type="url"
              value={settings.openai.endpoint}
              onChange={(e) => updateOpenAI({ endpoint: e.target.value })}
              placeholder="https://api.openai.com/v1/chat/completions"
            />
          </div>

          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              value={settings.openai.apiKey}
              onChange={(e) => updateOpenAI({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input
              value={settings.openai.model}
              onChange={(e) => updateOpenAI({ model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </div>

          <div className="space-y-1.5">
            <Label>System Prompt</Label>
            <Textarea
              value={settings.openai.systemPrompt}
              onChange={(e) => updateOpenAI({ systemPrompt: e.target.value })}
              placeholder="You are a translator..."
            />
            <p className="text-xs text-muted-foreground">
              Use {'{{targetLang}}'} as a placeholder for the target language.
            </p>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-start gap-2">
          <Checkbox
            id="developer-mode"
            checked={settings.developerMode}
            onCheckedChange={(checked) => update({ developerMode: checked === true })}
          />
          <div className="grid gap-0.5 leading-none">
            <Label htmlFor="developer-mode" className="cursor-pointer">Developer Mode</Label>
            <p className="text-xs text-muted-foreground">
              Enables access to features suitable for technical users.
            </p>
          </div>
        </div>

        {settings.developerMode && (
          <div className="space-y-1.5">
            <Label>Custom Skip Rules</Label>
            <Textarea
              value={settings.customRules}
              onChange={(e) => update({ customRules: e.target.value })}
              placeholder={'! Example: skip element on a specific site\n! reddit.com##[id="expand-search-button"]'}
              className="min-h-32 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Syntax: <code className="bg-muted px-1 rounded">domain##selector</code> — elements matching the CSS selector will not be translated.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
