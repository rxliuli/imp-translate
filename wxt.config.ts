import { defineConfig } from 'wxt'
import type { UserManifest } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import type { PublicPath } from 'wxt/browser'

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@extport/wxt'],
  extport: {
    extension: 'ext_uYoV9o8FAzvwJyFCBBHZ',
    safari: {
      appCategory: 'public.app-category.productivity',
      bundleIdentifier: 'com.rxliuli.imp-translate',
      developmentTeam: 'N2X78TUUFG',
    },
    // Daily anonymous usage ping + the Firefox data-collection declaration,
    // injected by @extport/wxt — see PRIVACY.md "Anonymous Usage Statistics".
    analytics: true,
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      tsconfigPaths: true,
    },
  }),
  manifestVersion: 3,
  manifest: (env) => {
    const manifest: UserManifest = {
      name: 'Imp Translate',
      description:
        'Bilingual page translation shown below the original. AI translation with no API key, or bring your own provider.',
      permissions: ['storage', 'scripting', 'webNavigation', 'alarms'],
      host_permissions: ['<all_urls>'],
      author: {
        email: 'rxliuli@gmail.com',
      },
      action: {
        default_icon: {
          '16': 'icon/16.png',
          '32': 'icon/32.png',
          '48': 'icon/48.png',
          '96': 'icon/96.png',
          '128': 'icon/128.png',
        },
        default_popup: 'popup.html',
      },
      web_accessible_resources: [
        {
          resources: ['/inject.js'] as PublicPath[],
          matches: ['<all_urls>'],
        },
      ],
      homepage_url: 'https://store.rxliuli.com/extensions/imp-translate/',
      commands: {
        'toggle-translate': {
          suggested_key: {
            default: 'Alt+A',
          },
          description: 'Toggle page translation',
        },
      },
    }
    if (env.browser === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id:
            manifest.name!.toLowerCase().replaceAll(/[^a-z0-9]/g, '-') +
            '@rxliuli.com',
        },
      }
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/author
      // @ts-expect-error
      manifest.author = 'rxliuli'
    }
    return manifest
  },
  webExt: {
    disabled: true,
    chromiumProfile: '.tmp/chrome-profile',
    keepProfileChanges: true,
    chromiumArgs: ['--remote-debugging-port=9222'],
  },
  hooks: {
    // wxt 0.21 生成的 .wxt/tsconfig.json 新增了 noUncheckedIndexedAccess，
    // 会把既有代码里 288 处索引访问判成可能 undefined。先用官方文档给的逃生口
    // 只回退这一项，是否采纳该严格模式要单独评估并单独改代码。
    // 注意 tsconfig 是整个文件的 JSON 内容，所以键在 compilerOptions 下面。
    'prepare:tsconfig': (_, { tsconfig }) => {
      delete tsconfig.compilerOptions.noUncheckedIndexedAccess
    },
  },
})
