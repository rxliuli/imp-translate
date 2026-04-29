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

If a site already has any `#+#` rule, it has switched to **include-only mode**: the DOM walker only descends into matching subtrees. New regions on that site need new `#+#` rules — adding `##` rules will not help.

## Workflow

1. **Read current rules**. Open `lib/rules.txt` and find the section for this domain. Note whether the site uses include rules, skip rules, or both. This determines what kind of rule to add.

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

5. **Add the rule** to `lib/rules.txt` under the appropriate `! Site` comment block. Keep one selector per line, use the same indentation/style as the surrounding rules. Examples:

   ```
   x.com#+#[data-testid^="message-text-"]
   reddit.com##[id="expand-search-button"]
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
