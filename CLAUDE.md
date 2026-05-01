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

## Dev loop with Claude Code

`pnpm dev` launches Chrome with `--remote-debugging-port=9222` and a persistent profile at `.tmp/chrome-profile/` (cookies/logins survive restarts; profile is gitignored).

### Connecting Claude Code to the running Chrome

`.mcp.json` configures `chrome-devtools` MCP with `--browserUrl=http://127.0.0.1:9222` so it attaches to the WXT-launched Chrome instead of spawning a fresh isolated one. After `pnpm dev` is running, **restart Claude Code** so the MCP server picks up the project config; then verify with `mcp__chrome-devtools__list_pages`.

If `list_pages` returns the wrong tabs (e.g. `about:blank` only) it means the MCP started its own Chrome — check that port 9222 is reachable (`curl http://127.0.0.1:9222/json/version`) and that the flag in `.mcp.json` is `--browserUrl` (camelCase; kebab-case is ignored by yargs).

### Driving the extension's service worker

In dev builds the background SW exposes `globalThis.__imp` (gated by `import.meta.env.DEV`, dropped in production):
- `__imp.toggle()` — same as toolbar click on active tab
- `__imp.start(lang?, tabId?)` — explicit start
- `__imp.stop(tabId?)` — explicit stop
- `__imp.state(tabId?)` — `{ tabId, lang | null }`

**chrome-devtools MCP filters out `service_worker` and `chrome-extension://` targets from `list_pages`**, so it can't reach `__imp` directly. Use `scripts/dev-cdp.mjs`, which talks to the SW via raw CDP WebSocket:

```bash
node scripts/dev-cdp.mjs open https://en.wikipedia.org/wiki/Main_Page
node scripts/dev-cdp.mjs eval "__imp.start('zh')"
node scripts/dev-cdp.mjs eval "__imp.state()"
node scripts/dev-cdp.mjs eval "__imp.toggle()"
```

The script hits `/json/list` to find the extension SW target, opens a WS, runs `Runtime.evaluate` with `awaitPromise: true`. Page DOM / console reads still go through chrome-devtools MCP (`evaluate_script`, `list_console_messages`) since regular http(s) tabs are visible to it.

Full loop: edit → WXT rebuilds + auto-reloads extension → `dev-cdp.mjs eval "__imp.toggle()"` to drive → MCP `evaluate_script` to verify DOM.
