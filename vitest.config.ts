import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          exclude: ['**/*.unit.test.ts', 'node_modules/**'],
          browser: {
            provider: playwright(),
            enabled: true,
            // https://vitest.dev/guide/browser/playwright
            instances: [{ browser: 'chromium', headless: true }],
          },
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          include: ['**/*.unit.test.ts'],
          exclude: ['*.test.ts', 'node_modules/**'],
        },
      },
    ],
  },
})
