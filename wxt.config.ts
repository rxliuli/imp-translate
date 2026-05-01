import { defineConfig, UserManifest } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import { PublicPath } from 'wxt/browser'

export default defineConfig({
  modules: ['@wxt-dev/module-react', 'wxt-module-safari-xcode'],
  safariXcode: {
    appCategory: 'public.app-category.productivity',
    bundleIdentifier: 'com.rxliuli.imp-translate',
    developmentTeam: 'N2X78TUUFG',
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
        'Bilingual page translation with Microsoft, Google, and OpenAI-compatible APIs',
      permissions: ['storage', 'scripting', 'webNavigation'],
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
      homepage_url: 'https://rxliuli.com/project/imp-translate',
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
          data_collection_permissions: {
            required: ['none'],
          },
        },
      }
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/author
      // @ts-expect-error
      manifest.author = 'rxliuli'
    }
    return manifest
  },
  webExt: {
    chromiumProfile: '.tmp/chrome-profile',
    keepProfileChanges: true,
    chromiumArgs: ['--remote-debugging-port=9222'],
  },
})
