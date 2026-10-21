import { AppRoutes } from './routes/AppRoutes'
import { DemoIdentityProvider } from './app/DemoIdentityProvider'

export default function App() {
  return <DemoIdentityProvider><AppRoutes /></DemoIdentityProvider>
}
