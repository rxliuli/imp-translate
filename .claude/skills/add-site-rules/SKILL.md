---
name: add-site-rules
description: Investigate a live page via Claude for Chrome and add missing site-specific include/skip rules to lib/rules.txt. Invoke with /add-site-rules <URL>.
argument-hint: <URL>
disable-model-invocation: true
---

# Add site rules from a live URL

The user gives a URL where Imp Translate currently mis-handles a site (some region not translated, or unrelated UI translated). Use claude-in-chrome to open the page, inspect the DOM, compare against `lib/rules.txt`, and add the minimal selectors needed.

Rule syntax recap (uBlock-style):

- `domain##selector` — skip (do not translate) matching elements
- `domain#+#selector` — include (only translate inside) matching elements
- `entity.*` — match any TLD via PSL (e.g. `google.*` covers `google.com`, `google.com.hk`)

## Pick the mode first: include vs skip

Choose the mode where the rule set is **bounded** for that site. Don't toggle modes site-by-page — the site picks one mode, the other is used only for refinements.

- **Include (`#+#`) — component-based platforms/apps**. Translatable content lives in named, repeatable containers; the rest is heavy localized chrome that changes often. Examples: Twitter/X, YouTube, Reddit, Instagram, TikTok, LinkedIn, Discord, Twitch, StackOverflow, GitHub issues/PRs. Decision: "are post/video/comment containers named and stable?" → yes → include.
- **Skip (`##`) — document/article sites**. Content fills the main flow; chrome is small and stable. Examples: Wikipedia, news sites, blogs, docs, MDN, technical reference. Decision: "would `<article>` / `<main>` already roughly contain it?" → yes → skip the chrome, let the rest translate.

UGC is a useful proxy ("UGC sites tend to be component-based") but Wikipedia is the counter-example — UGC by source, document-style by architecture, so skip wins there. Decide on architecture, not on who writes the content.

**The two modes compose**. On an include-mode site, add `##` rules to remove unwanted UI **inside** the include subtree (e.g. `youtube.com##yt-content-metadata-view-model` strips channel/views/age out of the `yt-lockup-view-model` include). The walker first narrows to includes, then applies skips within them.

## Workflow

1. **Read current rules**. Open `lib/rules.txt` and find the section for this domain.
   - If the domain has an existing section: follow its mode for consistency. Add to includes / skips as that section already does. If the existing mode genuinely doesn't fit (e.g. a skip-mode site grew enough new chrome that include is now bounded and skip isn't), propose flipping the section before adding rules — don't quietly mix.
   - If new domain: apply the decision tree above (component-based platform → include; document-style site → skip).

2. **Open the URL** with claude-in-chrome:
   - Load tools via `ToolSearch`: `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `javascript_tool`.
   - `tabs_context_mcp(createIfEmpty: true)` → grab tabId.
   - `navigate(tabId, url)` to the URL.

3. **Inspect the DOM** with `javascript_tool`. The job is to find a stable selector for the missing region. Useful queries:
   - Enumerate `[data-testid]` values: `[...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].sort()`. Filter by keyword (e.g. `dm`, `message`, `comment`).
   - Inspect a sample element: `tagName`, `parentElement?.dataset.testid`, child structure, `innerText.slice(0, 200)`.
   - For dynamic IDs (UUIDs, numbers), prefer attribute-prefix selectors: `[data-testid^="message-text-"]`.
   - Wait for SPA content to load — poll up to ~10s before reporting "not found".

4. **Pick the right selector level**. The DOM walker descends into include-matched subtrees, so target the wrapping container of the translatable region, not individual text nodes. Avoid selectors that capture pure UI labels (button text, static headers) unless the user wants those translated.

5. **Add the rule** to `lib/rules.txt` under the appropriate `! Site` comment block. Keep one selector per line, use the same indentation/style as the surrounding rules.

   **Always annotate the URL(s) the rule was verified against**, grouped so each URL sits directly above the rules it covers. Don't list multiple URLs at the top of a section and then dump all rules below — that breaks the URL-to-rule mapping. If a rule applies to several URLs, list all of them on the comment lines for that group. If an include rule and its companion skip rules belong to the same page, keep them in one group. This is what lets future maintainers re-visit one specific page, confirm whether *those* rules are still needed, and safely remove obsolete ones — without per-group URLs, the list is a one-way ratchet that only grows.

   **Use real, public, navigable URLs.** Pick a stable public page (Twitter's official `@x` account, a long-running YouTube video, a fixed search query) over placeholders like `<id>` or `<user>` — a contributor must be able to click the URL and reproduce the verification. Placeholders are acceptable only when the page is genuinely private or auth-gated and there is no public alternative (e.g. DM threads, account settings). In those cases, link to the entry point that *is* public (e.g. `https://x.com/messages`) and note that any thread can be used to verify. Examples:

   ```
   ! https://x.com/messages  (any DM thread; real URLs are private)
   x.com#+#[data-testid^="message-text-"]
   x.com#+#[data-testid^="dm-conversation-item-"]

   ! https://www.youtube.com/watch?v=V6kJKxvbgZ0  (watch page)
   youtube.com#+#ytd-watch-metadata
   youtube.com#+#ytd-comments
   youtube.com##ytd-watch-metadata #owner
   youtube.com##ytd-watch-metadata #actions
   youtube.com##ytd-watch-info-text
   ```

6. **Run `pnpm test`** to confirm `parseRules` still parses cleanly. The X / Reddit / Google rules tests don't cover specific selectors, but a malformed rule would surface in `parseRules` tests if any.

7. **Tell the user what you added and why**, in 2-3 sentences. Mention they need to reload the extension and re-trigger translation on the page to verify.

## Pitfalls

- **`activeTab` selectors with dynamic IDs**: Twitter/X, Reddit and similar SPAs use UUID/numeric suffixes on test-ids. Always check whether the prefix is stable across reloads before committing to `[data-testid^="..."]`.
- **Over-broad include rules**: `google.*#+#main` would cover Search, Drive, Docs, Gmail, etc. — and on pages without `main` it would suppress translation entirely. Scope subdomains explicitly when the site has multiple products (e.g. `www.google.*` vs `mail.google.*`).
- **Skip rules on include-only sites are no-ops**: if the domain only has `#+#` rules, the walker never reaches the elements a `##` rule would skip. Either drop the include rules or move the unwanted region to a more specific include selector.
- **CSP-restricted pages**: some sites (banking, GitHub Enterprise) block extension content scripts entirely. If `javascript_tool` works but the extension still doesn't translate, it's not a rules problem — back out and tell the user.

## Reference files

- `lib/rules.txt` — the rule list itself
- `lib/rules.ts` — `parseRules` (parser) and `matchRulesForDomain` (PSL-aware domain matcher)
- `lib/dom.ts` — `shouldSkip` shows exactly how include/skip selectors gate the walker
