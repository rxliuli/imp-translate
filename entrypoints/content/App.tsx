import { ShadowProvider } from '@/integrations/shadow/ShadowProvider'
import { ThemeProvider } from '@/integrations/theme/ThemeProvider'
import { Toaster } from 'sonner'
import { IndexPage } from './pages/IndexPage'

export function App(props: { container: HTMLElement }) {
  return (
    <ShadowProvider container={props.container}>
      <ThemeProvider>
        <Toaster richColors={true} closeButton={true} />
        <IndexPage />
      </ThemeProvider>
    </ShadowProvider>
  )
}
