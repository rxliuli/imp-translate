# Imp Translate

Cross-platform browser translation extension with bilingual display.

## Tech Stack
- WXT (WebExtension framework) + React + Tailwind CSS v4
- TypeScript, pnpm
- @webext-core/messaging for content↔background communication
- Shadow DOM for content script UI isolation

## Commands
- `pnpm dev` — dev mode (Chrome)
- `pnpm dev:firefox` — dev mode (Firefox)
- `pnpm build` — production build
- `pnpm test` — run tests (vitest + playwright browser mode)
- `pnpm compile` — type check

## Architecture
- `entrypoints/content/` — content script: DOM walking, translation injection
- `entrypoints/background.ts` — background script: API proxy
- `entrypoints/popup/` — popup UI (translate toggle, language selector)
- `entrypoints/options/` — options page (provider config)
- `lib/` — shared modules (DOM walker, translation APIs, messaging, storage)
- `components/` — shared React UI components (shadcn/ui)
