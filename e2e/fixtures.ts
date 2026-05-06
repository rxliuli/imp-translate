import { test as base, chromium, type BrowserContext } from '@playwright/test'
import path from 'path'
import { createTestServer } from './server'

const pathToExtension = path.resolve('.output/chrome-mv3')

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  baseURL: string
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--headless=new',
        // Aliases imp.test → 127.0.0.1 so site-rule tests can use a real
        // hostname (tldts can't match rules against IPs — they have no TLD).
        '--host-resolver-rules=MAP imp.test 127.0.0.1',
        // Bypass the system HTTP proxy: a dev-machine proxy without imp.test
        // in its exclusion list would otherwise intercept the alias and 502.
        '--proxy-server=direct://',
        '--proxy-bypass-list=*',
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers()
    if (!background) background = await context.waitForEvent('serviceworker')
    const extensionId = background.url().split('/')[2]
    await use(extensionId)
  },
  baseURL: async ({}, use) => {
    const server = createTestServer()
    const url = await server.start()
    await use(url)
    await server.stop()
  },
})

export const expect = test.expect
