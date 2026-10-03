# Imp Translate

An open-source, cross-platform browser extension for full-page web translation. Minimal by design.

## Goals

- Full-page translation, two display modes: bilingual (translation below the original) or replace (original text swapped in place, like Google Translate)
- Replace mode never breaks the page — it rewrites text nodes only, so React, Vue, Svelte and other framework-driven pages keep working and keep updating after translation
- Zero overhead by default — no code is injected into any page until you ask for translation
- Minimal — do one thing well, resist feature creep
- Cross-platform — Chrome, Edge, Firefox, Safari, including mobile

## Non-Goals

- Auto-injected UI (floating buttons, popups on hover, etc.)
- Word or sentence-level translation (selection, lookup, dictionaries)
- Input box translation (Discord, Slack, etc.)
- Video subtitle translation (YouTube, Netflix, etc.)
- Custom translation styling — will never be considered
- Document translation of any format (Docs, PDF, etc.)
- Compatibility with every website via custom rules — only the world's top 50 most-visited sites are prioritized
- Support for every LLM API provider — only OpenAI-compatible APIs are supported (many tools exist to convert other providers)

## Features

- Bilingual display: translations appear below original text
- Replace display: original text is replaced in place. Inline links, emphasis and citations keep their original elements; when the translation engine returns something that cannot be mapped back onto the existing nodes, the block falls back to a Google-style structural rewrite (logged to the console, outlined in Developer Mode)
- Supports Google, Microsoft, Imp Credits, and OpenAI-compatible translation providers
- Smart DOM walker: only translates visible content, handles SPAs, lazy-loaded content, and dynamic text changes
- Site-specific rules for skipping or targeting content areas (targeting rules apply to bilingual mode only; replace mode translates the whole page, navigation included)
- Shadow DOM isolation for injected UI

## Development

```sh
pnpm i
pnpm dev          # Chrome
pnpm dev:firefox  # Firefox
```

## Build

```sh
pnpm zip            # Chrome / Edge
pnpm zip:firefox    # Firefox
pnpm build:safari   # Safari (macOS + Xcode required)
```

## Test

```sh
pnpm test   # unit tests (vitest, browser mode)
pnpm e2e    # end-to-end tests (playwright + real extension)
```

## Site Rules

Built-in rules live in `lib/rules.txt` using uBlock Origin-inspired syntax:

```
domain##selector    — skip (do not translate) matching elements
domain#+#selector   — include (only translate inside) matching elements; bilingual mode only
entity.*            — match any TLD via Public Suffix List (e.g. google.* covers google.com, google.com.hk, google.co.uk)
```

Users can add custom rules via Developer Mode in the options page. Developer Mode also outlines translation issues on the page: blocks whose translation matched the original, blocks that needed a structural rewrite, and blocks that fell back to bilingual.

For per-site coverage status (which top-50 sites have explicit rules vs rely on the default DOM walker), see [`COMPATIBILITY.md`](./COMPATIBILITY.md).

### Contributing rules for a new site

If you use [Claude Code](https://claude.com/claude-code), this repo ships a project-scoped skill that automates the workflow: open the page, inspect the DOM, find the missing selectors, and append them to `lib/rules.txt`.

```
/add-site-rules https://example.com/some/page
```

Without Claude Code, the same workflow is documented step-by-step in `.claude/skills/add-site-rules/SKILL.md` — you can follow it manually with browser DevTools.
