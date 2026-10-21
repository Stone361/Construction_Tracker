import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoIdentityProvider } from '../app/DemoIdentityProvider'
import { useDemoIdentity } from '../app/DemoIdentityContext'
import { CreateHousePage } from '../pages/CreateHousePage'
import { createHouse } from '../services/createHouse'
import { ApiError } from '../services/apiClient'

vi.mock('../services/createHouse', async importOriginal => {
  const original = await importOriginal<typeof import('../services/createHouse')>()
  return { ...original, createHouse: vi.fn() }
})

function SwitchIdentity() {
  const { selectRole, selectSiteManager } = useDemoIdentity()
  return <>
    <button onClick={() => selectRole('ADMIN')}>Use Admin</button>
    <button onClick={() => selectRole('VIEWER')}>Use Viewer</button>
    <button onClick={() => selectSiteManager('Austin Council District 8')}>Use Site Manager</button>
  </>
}

function DetailProbe() {
  const { id } = useParams()
  return <p>House detail {id}</p>
}

function renderCreate() {
  return render(<DemoIdentityProvider><MemoryRouter initialEntries={['/houses/new']}>
    <SwitchIdentity /><Routes>
      <Route path="houses/new" element={<CreateHousePage />} />
      <Route path="houses/:id" element={<DetailProbe />} />
      <Route path="map" element={<p>Map workspace</p>} />
    </Routes>
  </MemoryRouter></DemoIdentityProvider>)
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Permit number/), 'P-12')
  await user.type(screen.getByLabelText(/^Address/), '12 Main St')
  await user.type(screen.getByLabelText(/Community \/ administrative area/), 'Austin Council District 8')
}

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(createHouse).mockReset()
})

describe('Admin create house page', () => {
  it('denies direct Viewer and Site Manager access, then updates immediately with identity', async () => {
    const user = userEvent.setup()
    renderCreate()
    expect(screen.getByRole('alert')).toHaveTextContent('Only Admin')
    expect(screen.queryByRole('button', { name: 'Create house' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use Site Manager' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Only Admin')
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    expect(screen.getByRole('button', { name: 'Create house' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    expect(screen.queryByRole('button', { name: 'Create house' })).not.toBeInTheDocument()
    expect(createHouse).not.toHaveBeenCalled()
  })

  it('validates required fields and coordinates before any POST', async () => {
    const user = userEvent.setup()
    renderCreate()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    expect(screen.getByText('Permit number is required.')).toBeInTheDocument()
    expect(screen.getByText('Address is required.')).toBeInTheDocument()
    expect(screen.getByText('Community is required.')).toBeInTheDocument()
    await fillRequired(user)
    await user.type(screen.getByLabelText('Latitude'), '91')
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    expect(screen.getByText(/-90 to 90/)).toBeInTheDocument()
    expect(screen.getByText('Enter latitude and longitude together.')).toBeInTheDocument()
    expect(createHouse).not.toHaveBeenCalled()
  })

  it('submits once, preserves input on backend failure, then opens the response ID', async () => {
    const user = userEvent.setup()
    let rejectFirst!: (error: Error) => void
    vi.mocked(createHouse).mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce({ id: 42, kind: 'created' })
    renderCreate()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await fillRequired(user)
    await user.type(screen.getByLabelText('Latitude'), '30.2672')
    await user.type(screen.getByLabelText('Longitude'), '-97.7431')
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    expect(screen.getByRole('button', { name: 'Creating house…' })).toBeDisabled()
    expect(createHouse).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createHouse).mock.calls[0]?.[0]).toMatchObject({ permitNo: 'P-12',
      address: '12 Main St', community: 'Austin Council District 8', lat: 30.2672, lng: -97.7431 })
    rejectFirst(new ApiError('The current demo identity is not permitted (HTTP 403).', 403))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403')
    expect(screen.getByLabelText(/Permit number/)).toHaveValue('P-12')
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    expect(await screen.findByText('House detail 42')).toBeInTheDocument()
    expect(createHouse).toHaveBeenCalledTimes(2)
  })

  it('does not apply an old Admin response after switching to Viewer', async () => {
    const user = userEvent.setup()
    let resolveOld!: (result: { id: number; kind: 'created' | 'existing' }) => void
    vi.mocked(createHouse).mockReturnValue(new Promise(resolve => { resolveOld = resolve }))
    renderCreate()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    const signal = vi.mocked(createHouse).mock.calls[0]?.[1]
    await user.click(screen.getByRole('button', { name: 'Use Viewer' }))
    await waitFor(() => expect(signal?.aborted).toBe(true))
    resolveOld({ id: 77, kind: 'existing' })
    expect(screen.getByRole('alert')).toHaveTextContent('Only Admin')
    expect(screen.queryByText('House detail 77')).not.toBeInTheDocument()
  })

  it('cancels back to the map without a POST', async () => {
    const user = userEvent.setup()
    renderCreate()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await user.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(screen.getByText('Map workspace')).toBeInTheDocument()
    expect(createHouse).not.toHaveBeenCalled()
  })

  it('keeps the form and offers a deliberate choice for an existing permit without another POST', async () => {
    const user = userEvent.setup()
    vi.mocked(createHouse).mockResolvedValue({ id: 17, kind: 'existing' })
    renderCreate()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    const warning = await screen.findByRole('alert', { name: 'House already exists' })
    expect(warning).toHaveTextContent('A house with this permit number already exists. No new house was created.')
    expect(screen.getByRole('heading', { name: 'House already exists' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Create house' })).toBeDisabled()
    expect(screen.getByLabelText(/Permit number/)).toHaveValue('P-12')
    expect(createHouse).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Stay here' }))
    expect(screen.queryByRole('alert', { name: 'House already exists' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Permit number/)).toHaveValue('P-12')
    expect(screen.getByRole('button', { name: 'Create house' })).toBeEnabled()
    expect(createHouse).toHaveBeenCalledTimes(1)
  })

  it('uses the existing response ID only when View existing house is chosen', async () => {
    const user = userEvent.setup()
    vi.mocked(createHouse).mockResolvedValue({ id: 17, kind: 'existing' })
    renderCreate()
    await user.click(screen.getByRole('button', { name: 'Use Admin' }))
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create house' }))
    await screen.findByRole('alert', { name: 'House already exists' })
    await user.click(screen.getByRole('button', { name: 'View existing house' }))
    expect(screen.getByText('House detail 17')).toBeInTheDocument()
    expect(createHouse).toHaveBeenCalledTimes(1)
  })
})
