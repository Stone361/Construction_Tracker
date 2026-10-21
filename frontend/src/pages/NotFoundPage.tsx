import { Link } from 'react-router'
import { PageIntro } from '../components/PageIntro'

export function NotFoundPage() {
  return (
    <PageIntro eyebrow="404" title="Page not found">
      <p>This address does not lead to a page in this workspace.</p>
      <Link to="/">Return to workspace</Link>
    </PageIntro>
  )
}
