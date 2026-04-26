import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import styles from './style.css?inline'
import styles2 from 'sonner/dist/styles.css?inline'
import { addStyle } from '@/lib/addStyle.ts'

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'example-ui',
      position: 'modal',
      anchor: 'body',
      onMount: (container) => {
        const shadowEl = document.querySelector('example-ui') as HTMLElement
        const shadow = shadowEl!.shadowRoot!
        shadowEl.style.zIndex = '9999'
        addStyle(shadow, [styles, styles2])

        // Container is a body, and React warns when creating a root on the body, so create a wrapper div
        const app = document.createElement('div')
        container.append(app)

        // Create a root on the UI container and render a component
        const root = ReactDOM.createRoot(app)
        root.render(<App container={container} />)
        return root
      },
      onRemove: (root) => {
        // Unmount the root when the UI is removed
        root?.unmount()
      },
    })

    // 4. Mount the UI
    ui.mount()
  },
})
