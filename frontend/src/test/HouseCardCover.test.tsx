import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HouseCard } from '../components/HouseCard'
import { DemoIdentityProvider } from '../app/DemoIdentityProvider'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import type { HouseSummary } from '../services/houses'

const house: HouseSummary = {
  id: 225, address: '225 Main St', permitNo: 'P-225', community: 'Austin Council District 8',
  stage: 'FOUNDATION', lastPhotoBusinessDate: null, lat: 30.27, lng: -97.74,
  coverPhotoUrl: '/api/houses/225/photos/77/file',
}

function SwitchIdentity() {
  const { selectRole, selectSiteManager } = useDemoIdentity()
  return <>
    <button onClick={() => selectRole('ADMIN')}>Use Admin</button>
    <button onClick={() => selectSiteManager('Austin Council District 5')}>Use Site Manager</button>
  </>
}

let reveal!: () => void
beforeEach(() => {
  class Observer {
    constructor(private callback: IntersectionObserverCallback) {
      reveal = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  let next = 0
  URL.createObjectURL = vi.fn(() => `blob:cover-${++next}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

it('loads only a visible card cover and replaces identity-scoped Blob URLs for all readers', async () => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(new Blob(['image'], { type: 'image/png' }), {
    status: 200, headers: { 'Content-Type': 'image/png' },
  })))
  vi.stubGlobal('fetch', fetchMock)
  const view = render(<DemoIdentityProvider><SwitchIdentity /><HouseCard house={house} onSelect={() => {}} /></DemoIdentityProvider>)
  expect(fetchMock).not.toHaveBeenCalled()
  act(() => reveal())
  expect(await screen.findByRole('img', { name: 'Cover of 225 Main St' })).toHaveAttribute('src', 'blob:cover-1')
  expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({ 'X-Role': 'VIEWER' })

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Use Admin' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Cover of 225 Main St' })).toHaveAttribute('src', 'blob:cover-2'))
  expect(fetchMock.mock.calls[1]?.[1].headers).toMatchObject({ 'X-Role': 'ADMIN' })
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')

  await user.click(screen.getByRole('button', { name: 'Use Site Manager' }))
  await waitFor(() => expect(screen.getByRole('img', { name: 'Cover of 225 Main St' })).toHaveAttribute('src', 'blob:cover-3'))
  expect(fetchMock.mock.calls[2]?.[1].headers).toMatchObject({
    'X-Role': 'SITE_MANAGER', 'X-Community': 'Austin Council District 5',
  })
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-3')
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('uses the original placeholder without a request when no cover is selected', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(<HouseCard house={{ ...house, coverPhotoUrl: null }} onSelect={() => {}} />)
  act(() => reveal())
  expect(screen.queryByRole('img', { name: /Cover of/ })).not.toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('retains a selectable card with a clear fallback and retry after a failed cover read', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValue(new Response(new Blob(['image'], { type: 'image/png' }), {
      status: 200, headers: { 'Content-Type': 'image/png' },
    }))
  vi.stubGlobal('fetch', fetchMock)
  render(<HouseCard house={house} onSelect={() => {}} />)
  act(() => reveal())
  expect(await screen.findByRole('alert')).toHaveTextContent('Cover unavailable')
  expect(screen.getByRole('button', { name: 'View 225 Main St' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Retry cover' }))
  expect(await screen.findByRole('img', { name: 'Cover of 225 Main St' })).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
