# Compatibility

This extension targets the world's most-visited websites listed at
[Wikipedia: List of most-visited websites](https://en.wikipedia.org/wiki/List_of_most-visited_websites).
Every entry below is treated as first-class scope — PRs that add or
improve rules for any of them are welcomed and will be reviewed.

For sites outside this list, the default DOM walker handles most
document-style pages adequately; component-based platforms typically
need explicit rules. Use `/add-site-rules <URL>` (see
`.claude/skills/add-site-rules/SKILL.md`) for the workflow.

## Status

- **Done** — explicit rules in `lib/rules.txt`; main pages verified.
- **Partial** — some rules exist; known gaps remain.
- **Default** — no explicit rules; the default DOM walker handles the site adequately. Verify before assuming.
- **TODO** — needs rules; default walker leaves obvious gaps.
- **Out of scope** — covered by Non-Goals in `README.md` (video subtitles, document translation, etc.) or not actively pursued.

## Priority sites

Sites the maintainer uses regularly and verifies first. Other sites in the full list below also welcome PRs.

- [x] Google Search
- [x] YouTube
- [x] Twitter / X
- [x] Reddit — flipped to include mode; covers post titles, text-body, comments via shreddit web component slots. Reddit Chat (`reddit.com/chat/*`) targets `.room-message-text` inside `rs-timeline-event` shadow roots — the walker pierces open shadow DOM
- [x] Wikipedia — default walker + skip section-heading [edit] links
- [x] GitHub — default walker + skip repo-home file tree (filename collides with commit message)
- [x] ChatGPT — include user / assistant message containers
- [x] Telegram Web — K client covered; A client (web.telegram.org/a) not verified

## Full list

| # | Site | Domain | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Google Search | google.com | Done | Search only; mail / drive / docs are different products |
| 2 | YouTube | youtube.com | Done | Include mode: lockup cards, watch metadata, comments |
| 3 | Facebook | facebook.com | TODO | Platform; needs include rules for post / comment containers |
| 4 | Instagram | instagram.com | TODO | Platform; mostly image-driven, but captions and comments are translatable |
| 5 | ChatGPT | chatgpt.com | Done | Include rule on `[data-message-author-role]` covers user prompts + assistant responses |
| 6 | X | x.com | Done | Include mode: tweets, profile bios, DMs, articles, follower cells, explore cards |
| 7 | Reddit | reddit.com | Done | Include `[slot="title"]`, `[slot="text-body"]`, `[slot="comment"]` covers feed + post detail; `.room-message-text` covers Reddit Chat (`/chat/*`) via shadow DOM piercing |
| 8 | Microsoft Bing | bing.com | Default | Search results page; default walker likely sufficient |
| 9 | WhatsApp | whatsapp.com | TODO | Web client at web.whatsapp.com; needs include rules for messages |
| 10 | Wikipedia | wikipedia.org | Done | Default walker + skip `.mw-editsection` ([edit] links beside headings) |
| 11 | TikTok | tiktok.com | TODO | Platform; video captions and comments need rules |
| 12 | Yahoo Japan | yahoo.co.jp | Default | News portal; verify |
| 13 | Yahoo! | yahoo.com | Default | News portal; verify |
| 14 | Yandex | yandex.ru | Default | Search; verify |
| 15 | Gemini | gemini.google.com | TODO | Chat platform; needs include rules for assistant messages |
| 16 | Amazon | amazon.com | TODO | Product titles / descriptions / reviews need scoping |
| 17 | LinkedIn | linkedin.com | TODO | Platform; feed posts and articles need include rules |
| 18 | Baidu | baidu.com | Default | Search; verify |
| 19 | BET.br | bet.br | Out of scope | Online gambling |
| 20 | Naver | naver.com | Default | News portal; verify |
| 21 | Netflix | netflix.com | Out of scope | Video subtitle translation is a Non-Goal |
| 22 | Pinterest | pinterest.com | TODO | Platform; pin titles and descriptions need rules |
| 23 | Outlook (Live) | live.com | TODO | Email client; sender / subject / body containers need rules |
| 24 | Pornhub | pornhub.com | Out of scope | Not actively pursued; PR welcome |
| 25 | Dzen News | dzen.ru | Default | News portal; verify |
| 26 | Bilibili | bilibili.com | TODO | Video platform; titles, descriptions, comments need rules |
| 27 | Temu | temu.com | TODO | Marketplace; product titles and descriptions need rules |
| 28 | xHamster | xhamster.com | Out of scope | Not actively pursued; PR welcome |
| 29 | Microsoft | microsoft.com | Default | Marketing pages; verify |
| 30 | Microsoft 365 | office.com | Out of scope | Document translation is a Non-Goal |
| 31 | XVideos | xvideos.com | Out of scope | Not actively pursued; PR welcome |
| 32 | Microsoft (login) | login.live.com | Out of scope | Authentication only; nothing meaningful to translate |
| 33 | Twitch | twitch.tv | TODO | Stream titles, chat, channel bios need rules |
| 34 | Canva | canva.com | Out of scope | Design tool; in-canvas content not the target |
| 35 | Weather | weather.com | Default | Forecast pages; verify |
| 36 | VK | vk.com | TODO | Platform; needs include rules |
| 37 | Globo | globo.com | Default | News portal; verify |
| 38 | Samsung | samsung.com | Default | Marketing pages; verify |
| 39 | Yahoo News Japan | news.yahoo.co.jp | Default | News articles; verify |
| 40 | Mail.ru | mail.ru | Default | Portal; verify |
| 41 | Fandom | fandom.com | Default | Wiki; document-style, default walker likely fits |
| 42 | Telegram | t.me / web.telegram.org | Done | Web /k client: include `.bubble .message`, skip `.time`. The /a client at web.telegram.org/a not yet verified |
| 43 | The New York Times | nytimes.com | Default | News articles; verify |
| 44 | DuckDuckGo | duckduckgo.com | Default | Search results; verify |
| 46 | Stripchat | stripchat.com | Out of scope | Adult camming; not actively pursued |
| 48 | GitHub | github.com | Done | Default walker handles `.markdown-body` (issues/PRs/READMEs); skip `.react-directory-row` to keep filenames intact in repo home |
| 49 | XNXX | xnxx.com | Out of scope | Not actively pursued; PR welcome |
| 50 | Claude | claude.ai | TODO | Chat platform; needs include rules for assistant messages |

Ranks 45 and 47 are absent from the source table at the time this list was built (`rowspan` collapsing in Wikipedia's table); update if they reappear.

## Known limitations

- **Other DOM mutators in replace mode** — a page script or another extension that rewrites our translated text in place can leave a translation on screen that nothing can put back; see [Replace mode: why `Text.data`](#replace-mode-why-textdata-and-what-still-ours-means).
- **Closed shadow roots** — the DOM walker pierces open shadow roots (`el.shadowRoot != null`), which covers most modern web components including Reddit Chat. Closed shadow roots (created with `attachShadow({ mode: 'closed' })`) remain unreachable; if a site adopts them for UGC, no rule can recover the content.
- **Mobile toast bar under hostile page CSS** — the language/restore/settings panel is the only UI that floats over the page and has to look identical everywhere, so it renders in its own shadow root with a `:host { … !important }` boundary (`lib/render.ts`); page skins can't resize it or hide its controls (e2e/toast-isolation.spec.ts pins this against an AO3-style skin). Two things it still can't fix: a `transform` / `filter` / `backdrop-filter` / `will-change` on `<html>` breaks `position: fixed` for everyone, and the site's own JavaScript can remove the host node.

## Replace mode: why `Text.data`, and what "still ours" means

Replace mode overwrites the page's own text instead of appending a translation
next to it. Every way of doing that has a blind spot; this section records which
one this project lives with and why, so the choice can be checked later — or
overturned with evidence instead of taste.

### The three designs

| Translation is written as | Ownership signal | Robust to | Broken by |
| --- | --- | --- | --- |
| a wrapper element (`<font>`, `<span>`) holding the translated text — Chrome/Google web translate, Safari's TextManipulationController | DOM structure | other scripts rewriting the text | the page's own framework updating nodes it no longer owns (detached-node writes, throws on `insertBefore`) |
| a replacement text node plus a side table of originals — most "replace" translation extensions | node identity + table | page scripts editing text | same framework problem: the node the page holds is gone |
| `Text.data` on the page's existing text nodes — this extension | the text itself | React/Preact/Vue/Svelte/Solid/Lit/Angular updates, layout, selection, `:nth-child`, CSS inheritance | any other writer touching the same text node |

A text node cannot carry an attribute, so with the third design **content is the
only ownership signal available**. That is the whole trade: transparency to the
page's framework (the reason replace mode exists — see the header of
`lib/replace.ts` and the React 19 case in `e2e/replace-mode.spec.ts`) in exchange
for having to guess, from the text, whether a node is still ours.

### What failed, and the rule that replaced it

Reported on Wikipedia and AO3: after "restore", some translated elements stayed
translated. Cause, confirmed from `[imp-replace]` diagnostics: a userscript that
inserts spaces between CJK and Latin (`為什麼你們就是不能加個空格呢？`) rewrites
our translated text node a frame after we write it. Ownership was decided with
`node.data === rec.translated`; the re-spaced node no longer matched, so

1. the record was dropped and the text **on screen** (our translation) was
   recorded as the page's original — poisoning every later retranslation of that
   block, and
2. restore skipped the node and left the translation on screen.

The same applies to any in-place decorator: RTL and punctuation fixers, other
translator extensions, scripts inserting thousands separators. A second round on
AO3 showed the punctuation half of it: our `朱迪·阿尔瓦雷斯` (U+00B7 interpunct)
came back as `朱迪・阿尔瓦雷斯` (U+30FB katakana middle dot) with a zero-width
joiner appended — a substitution, not a spacing change.

The rule is now `holdsTranslation(node, rec)` in `lib/replace.ts`: the two texts
must have the same **skeleton** — letters and digits compared as they are,
whitespace and format characters (`\p{Cf}`, which is where zero-width joiners
live) dropped, and every run of punctuation/symbols collapsed into one marker.
That covers spacing scripts, `·`→`・` and `,`→`，` normalizers, and invisible
characters, while still failing on real content edits. It is used everywhere
ownership is decided (`getSourceText`, `collectReplaceableTextNodes`,
`restoreNodes`).

### What it still does not cover

Letters and digits must match exactly, so a decorator that inserts words or
changes characters rather than punctuation (`1,000` → `1 000` is fine, but `km`
appended, numbers spelled out, or a script converting between simplified and
traditional Chinese) still mismatches and reproduces the same bug. Loosening
that (edit distance, subsequence matching) trades a rare missed restore for a
risk of overwriting what the page really wrote, so it needs evidence before it
is worth taking.

### Why not the `<font>` wrapper

Structural ownership is genuinely more robust against other writers, and it is
why Chrome's built-in translate does not have this bug. It is also one-shot: it
does not follow dynamic text. Wrapping or replacing text nodes makes the
frameworks above write into detached nodes or throw, which blanks pages — this
extension stays attached for the whole session and must survive the page's own
updates. Segment writes (one paragraph spread over `<a>`/`<b>` text nodes) also
map onto existing nodes; a wrapper approach has to clone the inline elements to
keep a link clickable, which is `lib/rewrite.ts`'s rarely-taken last resort.

### When to revisit this decision

Reconsider if (a) decorators that change letters or digits turn out to be common
enough to justify fuzzy matching, or (b) a target site needs a faithful restore
while mutating our blocks heavily. The cost of switching: the
extraction and visibility layer is text-node based (`lib/dom.ts`), segment writes
would have to rebuild inline structure, selection / `:nth-child` / CSS
inheritance regress, and the SPA guarantee — the reason replace mode exists — is
lost.

Diagnostics for the next round: a dev build (`pnpm dev`) logs `[imp-replace]`
warnings in the page console (prune / collect / restore say why a record was
dropped or a node left alone).

