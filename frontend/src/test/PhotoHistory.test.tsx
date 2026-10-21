import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotoHistory } from '../components/PhotoHistory'
import type { HousePhoto } from '../services/houseDetail'

const photos: HousePhoto[] = [
  { id: 8, stage: 'LAND_CLEARING', takenAt: '2026-01-01T04:00:00Z',
    uploadedAt: '2026-01-03T07:00:00Z', businessDate: '2025-12-31', url: '/api/houses/12/photos/8/file' },
  { id: 9, stage: 'FRAMING', takenAt: null, uploadedAt: null, businessDate: null,
    url: '/api/houses/12/photos/9/file' },
]

afterEach(() => document.getElementById('root')?.remove())

describe('photo history placeholders and interactions', () => {
  it('shows an honest empty state without inventing photo cards', () => {
    render(<PhotoHistory photos={[]} />)
    expect(screen.getByText('No site photos yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Preview photo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Scroll photos/ })).not.toBeInTheDocument()
  })

  it('places a disabled upload card after real photos without adding it to the lightbox', async () => {
    const user = userEvent.setup()
    render(<PhotoHistory photos={photos} canUpload />)
    const rail = screen.getByRole('list', { name: 'House photo history' })
    const cards = within(rail).getAllByRole('listitem')
    expect(cards).toHaveLength(3)
    expect(within(cards[2]!).getByRole('button', { name: 'Upload photo coming soon' })).toBeDisabled()
    await user.click(within(cards[2]!).getByRole('button', { name: 'Upload photo coming soon' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview photo 1' }))
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
  })

  it('shows the upload card even with no photos, while preserving the empty message', () => {
    render(<PhotoHistory photos={[]} canUpload />)
    expect(screen.getByText('No site photos yet.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'House photo history' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload photo coming soon' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Preview photo/ })).not.toBeInTheDocument()
  })

  it('keeps real metadata distinct from the placeholder, previews the selected photo, and restores focus', async () => {
    const user = userEvent.setup()
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    render(<PhotoHistory photos={photos} />, { container: root })
    const first = screen.getByRole('button', { name: 'Preview photo 1' })
    const second = screen.getByRole('button', { name: 'Preview photo 2' })
    expect(within(first).getByText('Land clearing')).toBeInTheDocument()
    expect(within(first).getByText(/Jan 1, 2026.*UTC/)).toBeInTheDocument()
    expect(within(first).getByText(/Jan 3, 2026.*UTC/)).toBeInTheDocument()
    expect(within(second).getByText('Framing')).toBeInTheDocument()
    expect(within(second).getAllByText('Not available')).toHaveLength(2)
    expect(within(first).getByText('Image placeholder')).toBeInTheDocument()

    await user.click(first)
    const dialog = screen.getByRole('dialog', { name: 'Photo 1 of 2' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(root.inert).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(dialog).getByText('Land clearing')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Previous/ })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: /Next/ }))
    expect(screen.getByRole('dialog', { name: 'Photo 2 of 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
    expect(within(screen.getByRole('dialog')).getByText('Framing')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 2' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Photo 2 of 2' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(root.inert).toBe(false)
    expect(first).toHaveFocus()
  })

  it('only offers scroll arrows when the rail overflows and scrolls in both directions', async () => {
    const user = userEvent.setup()
    render(<PhotoHistory photos={photos} />)
    const rail = screen.getByRole('list', { name: 'House photo history' })
    Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(rail, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    const scrollBy = vi.fn()
    rail.scrollBy = scrollBy
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByRole('button', { name: 'Scroll photos left' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Scroll photos right' }))
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' })
    rail.scrollLeft = 600
    fireEvent.scroll(rail)
    expect(screen.getByRole('button', { name: 'Scroll photos right' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Scroll photos left' }))
    expect(scrollBy).toHaveBeenCalledWith({ left: -240, behavior: 'smooth' })
  })

  it('offers a direct way to find an authorized upload card beyond the visible photos', async () => {
    const user = userEvent.setup()
    render(<PhotoHistory photos={photos} canUpload />)
    const rail = screen.getByRole('list', { name: 'House photo history' })
    Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: 900 })
    const scrollTo = vi.fn()
    rail.scrollTo = scrollTo
    act(() => window.dispatchEvent(new Event('resize')))
    await user.click(screen.getByRole('button', { name: 'Upload card at end →' }))
    expect(scrollTo).toHaveBeenCalledWith({ left: 900, behavior: 'smooth' })
    expect(within(rail).getAllByRole('listitem').at(-1)).toHaveTextContent('Upload photo')
  })
})
