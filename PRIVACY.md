# Privacy Policy for Imp Translate

> Last updated: 2026-08-26

## Data Collection

Imp Translate does **not** collect any personal or sensitive user data — no browsing history, no page content, no translated text, and nothing that identifies you.

### Anonymous Usage Statistics

The extension sends **at most one anonymous ping per day** to our own infrastructure (extport, running on Cloudflare) so we can see how many installs are active and which versions are in use. Each ping contains exactly:

- a random install identifier (generated locally, not linked to you or your account on any service)
- the extension version
- your browser's UI language (e.g. `en-US`)

From the network request itself our server derives the browser, operating system, and country (the IP address is used only for the country lookup and is **not stored**). Raw pings are deleted after 90 days; only aggregate daily counts are kept. No browsing data, page content, or behavioral data is ever collected.

## Third-Party Translation Services

To provide translation functionality, the extension sends the text you select directly from your browser to a translation service based on your chosen settings. The supported providers are:

- **Google Translate** (default, no API key required)
- **Microsoft Translator** (no API key required)
- **Imp Credits** (hosted, metered translation via your Imp account)
- **OpenAI-compatible API** (user-configured endpoint and API key)

For **Google Translate**, **Microsoft Translator**, and the **OpenAI-compatible API**, no data passes through or is stored on our own infrastructure — the text is sent directly from your browser to the selected service.

### Imp Credits

When you choose **Imp Credits**, the text you translate and the target language are sent to our own hosted translation service at **imp.rxliuli.com** to produce the translation. Your browser sends the selected text there; it is not passed to a third party. Imp Credits also stores a per-connection API key (created when you connect your Imp account) used to authorize and meter your usage.

## Data Storage

All extension settings and configurations (including API keys, if applicable) are stored **locally in your browser** using the browser storage API. No data is stored on external servers.

## Data Sharing

We do **not** sell, trade, or share any user data with third parties. The only external data transmission is the text sent to the translation service you choose, as described above.

## Open Source

This extension is fully open source. You can review the complete source code at https://github.com/rxliuli/imp-translate.

## Contact

If you have questions about this privacy policy, contact us at: rxliuli@gmail.com
