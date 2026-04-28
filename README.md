# Imp Translate

An open-source, cross-platform browser extension for bilingual web page translation. Minimal by design.

## Goals

- Full-page bilingual translation only — original text stays visible
- Zero overhead by default — no code is injected into any page until you ask for translation
- Minimal — do one thing well, resist feature creep
- Cross-platform — Chrome, Edge, Firefox, Safari, including mobile

## Non-Goals

- Auto-injected UI (floating buttons, popups on hover, etc.)
- In-place replacement translation (like Google Translate)
- Word or sentence-level translation (selection, lookup, dictionaries)
- Input box translation (Discord, Slack, etc.)
- Video subtitle translation (YouTube, Netflix, etc.)
- Custom translation styling — will never be considered
- Document translation of any format (Docs, PDF, etc.)
- Compatibility with every website via custom rules — only the world's top 50 most-visited sites are prioritized
- Support for every LLM API provider — only OpenAI-compatible APIs are supported (many tools exist to convert other providers)

## Features

- Bilingual display: translations appear below original text
- Supports OpenAI-compatible, Google, and Microsoft translation providers
- Smart DOM walker: only translates visible content, handles SPAs, lazy-loaded content, and dynamic text changes
- Site-specific rules for skipping or targeting content areas
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
domain#+#selector   — include (only translate inside) matching elements
entity.*            — match any TLD via Public Suffix List (e.g. google.* covers google.com, google.com.hk, google.co.uk)
```

Users can add custom rules via Developer Mode in the options page.
