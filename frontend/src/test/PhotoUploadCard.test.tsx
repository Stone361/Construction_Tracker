import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoUploadCard } from '../components/PhotoUploadCard'
import { ApiError } from '../services/apiClient'
import { uploadHousePhoto } from '../services/photoUpload'

vi.mock('../services/photoUpload', async importOriginal => {
  const original = await importOriginal<typeof import('../services/photoUpload')>()
  return { ...original, uploadHousePhoto: vi.fn() }
})

const png = () => new File(['image'], 'site.png', { type: 'image/png' })
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:selected-photo')
  URL.revokeObjectURL = vi.fn()
  vi.mocked(uploadHousePhoto).mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('photo upload card', () => {
  it('chooses one image, previews it, and cancels without sending a request', async () => {
    const user = userEvent.setup()
    render(<PhotoUploadCard houseId={228} />)
    const chooser = screen.getByRole('button', { name: 'Upload photo' })
    const input = screen.getByLabelText('Choose photo file') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(chooser)
    expect(click).toHaveBeenCalledOnce()
    await user.upload(input, png())
    expect(screen.getByText('site.png')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Selected photo preview' })).toHaveAttribute('src', 'blob:selected-photo')
    expect(uploadHousePhoto).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:selected-photo')
    expect(uploadHousePhoto).not.toHaveBeenCalled()
  })

  it('rejects multiple or invalid dropped files and accepts one valid drop', () => {
    render(<PhotoUploadCard houseId={228} />)
    const zone = screen.getByRole('button', { name: 'Upload photo' }).parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [png(), png()] } })
    expect(screen.getByRole('alert')).toHaveTextContent('one photo at a time')
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'bad.svg', { type: 'image/svg+xml' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('JPEG, PNG, or WebP')
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } })
    expect(screen.getByText('site.png')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows indeterminate progress, prevents duplicate submission, and reports the outcome once', async () => {
    let complete!: (value: { status: 201; photoId: number; gpsStatus: 'VERIFIED' }) => void
    vi.mocked(uploadHousePhoto).mockReturnValue(new Promise(resolve => { complete = resolve }))
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<PhotoUploadCard houseId={228} onComplete={onComplete} />)
    await user.upload(screen.getByLabelText('Choose photo file'), png())
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    expect(screen.getByRole('progressbar', { name: 'Upload in progress' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm upload' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(uploadHousePhoto).toHaveBeenCalledTimes(1)
    complete({ status: 201, photoId: 93, gpsStatus: 'VERIFIED' })
    expect(await screen.findByRole('alertdialog', { name: 'Photo uploaded successfully' })).toHaveTextContent('GPS status: VERIFIED')
    expect(onComplete).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Back to upload' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Back to upload' }))
    expect(document.body.style.overflow).toBe('')
    expect(onComplete).toHaveBeenCalledWith({ status: 201, photoId: 93, gpsStatus: 'VERIFIED' })
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(uploadHousePhoto).toHaveBeenCalledTimes(1)
  })

  it('keeps a duplicate warning open until acknowledged and returns to the upload chooser', async () => {
    vi.mocked(uploadHousePhoto).mockResolvedValue({ status: 200, photoId: 91, gpsStatus: 'SUSPECT' })
    const onComplete = vi.fn()
    const user = userEvent.setup()
    render(<PhotoUploadCard houseId={228} onComplete={onComplete} />)
    await user.upload(screen.getByLabelText('Choose photo file'), png())
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Photo already exists' })
    expect(dialog).toHaveTextContent('No new photo was created')
    expect(dialog).toHaveTextContent('GPS status: SUSPECT')
    expect(onComplete).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(onComplete).toHaveBeenCalledWith({ status: 200, photoId: 91, gpsStatus: 'SUSPECT' })
    expect(uploadHousePhoto).toHaveBeenCalledTimes(1)
  })

  it('keeps the selected file after an HTTP error and ignores a late result after unmount', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadHousePhoto).mockRejectedValueOnce(new ApiError('Too large (HTTP 413).', 413))
    const onComplete = vi.fn()
    const view = render(<PhotoUploadCard houseId={228} onComplete={onComplete} />)
    await user.upload(screen.getByLabelText('Choose photo file'), png())
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 413')
    expect(screen.getByText('site.png')).toBeInTheDocument()

    let complete!: (value: { status: 200; photoId: number; gpsStatus: 'UNKNOWN' }) => void
    vi.mocked(uploadHousePhoto).mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
    await user.click(screen.getByRole('button', { name: 'Confirm upload' }))
    view.unmount()
    complete({ status: 200, photoId: 91, gpsStatus: 'UNKNOWN' })
    await Promise.resolve()
    expect(onComplete).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:selected-photo')
  })
})
