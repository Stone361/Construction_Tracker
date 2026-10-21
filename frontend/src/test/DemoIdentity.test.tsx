import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoIdentityProvider } from '../app/DemoIdentityProvider'
import { DemoIdentitySelector } from '../app/DemoIdentitySelector'
import { identityStorageKey, identityStorageVersion, restoreDemoIdentity, useDemoIdentity } from '../app/DemoIdentityContext'
import { getCommunityNames } from '../services/houses'

vi.mock('../services/houses', async importOriginal => {
  const original = await importOriginal<typeof import('../services/houses')>()
  return { ...original, getCommunityNames: vi.fn() }
})

function IdentityProbe() {
  const { identity, version } = useDemoIdentity()
  return <output data-testid="identity">{identity.role}:{identity.community ?? 'none'}:{version}</output>
}

function renderSelector() {
  return render(<DemoIdentityProvider><DemoIdentitySelector /><IdentityProbe /></DemoIdentityProvider>)
}

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(getCommunityNames).mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('global demo identity selector', () => {
  it('defaults to Viewer, switches to Admin immediately, and restores the same choice in this tab', async () => {
    const user = userEvent.setup()
    const first = renderSelector()
    expect(screen.getByTestId('identity')).toHaveTextContent('VIEWER:none:0')
    await user.selectOptions(screen.getByLabelText('Demo identity'), 'ADMIN')
    expect(screen.getByTestId('identity')).toHaveTextContent('ADMIN:none:1')
    expect(screen.getByLabelText('Demo identity')).toHaveValue('ADMIN')
    first.unmount()
    renderSelector()
    expect(screen.getByTestId('identity')).toHaveTextContent('ADMIN:none:0')
    await user.selectOptions(screen.getByLabelText('Demo identity'), 'VIEWER')
    expect(screen.getByTestId('identity')).toHaveTextContent('VIEWER:none:1')
  })

  it('does not apply Site Manager until a real returned community is chosen', async () => {
    vi.mocked(getCommunityNames).mockResolvedValue(['Austin Council District 5', 'Austin Council District 8'])
    const user = userEvent.setup()
    renderSelector()
    await user.selectOptions(screen.getByLabelText('Demo identity'), 'SITE_MANAGER')
    expect(screen.getByTestId('identity')).toHaveTextContent('VIEWER:none:0')
    const communities = await screen.findByLabelText('Site Manager community')
    await user.selectOptions(communities, 'Austin Council District 8')
    expect(screen.getByTestId('identity')).toHaveTextContent('SITE_MANAGER:Austin Council District 8:1')
    expect(screen.queryByLabelText('Site Manager community')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Demo identity'), 'VIEWER')
    expect(screen.getByTestId('identity')).toHaveTextContent('VIEWER:none:2')
  })

  it('keeps the existing identity when community lookup fails or returns no houses', async () => {
    vi.mocked(getCommunityNames).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const user = userEvent.setup()
    renderSelector()
    await user.selectOptions(screen.getByLabelText('Demo identity'), 'SITE_MANAGER')
    expect(await screen.findByRole('alert')).toHaveTextContent('Communities could not be loaded.')
    await user.click(screen.getByRole('button', { name: 'Retry communities' }))
    expect(await screen.findByText('No communities are available from house data.')).toBeInTheDocument()
    expect(screen.getByTestId('identity')).toHaveTextContent('VIEWER:none:0')
  })

  it('rejects malformed or incomplete session identities', () => {
    expect(restoreDemoIdentity('{broken')).toMatchObject({ role: 'VIEWER' })
    expect(restoreDemoIdentity(JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'SITE_MANAGER', community: null } })))
      .toMatchObject({ role: 'VIEWER' })
    expect(restoreDemoIdentity(JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: 'Wrong' } })))
      .toMatchObject({ role: 'VIEWER' })
    expect(restoreDemoIdentity(JSON.stringify({ user: 'frontend-demo', role: 'ADMIN', community: null })))
      .toMatchObject({ role: 'VIEWER' })
    expect(restoreDemoIdentity(JSON.stringify({ version: 0,
      identity: { user: 'frontend-demo', role: 'ADMIN', community: null } })))
      .toMatchObject({ role: 'VIEWER' })
    sessionStorage.setItem(identityStorageKey, JSON.stringify({ version: identityStorageVersion,
      identity: { user: 'frontend-demo', role: 'SITE_MANAGER', community: 'Austin Council District 8' } }))
    renderSelector()
    expect(screen.getByTestId('identity')).toHaveTextContent('SITE_MANAGER:Austin Council District 8:0')
  })
})
