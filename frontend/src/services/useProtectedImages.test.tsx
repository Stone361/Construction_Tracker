import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { viewerIdentity } from '../app/DemoIdentityContext'
import { useProtectedImages } from './useProtectedImages'

const path = '/api/houses/12/photos/8/file'
const otherPath = '/api/houses/13/photos/9/file'
const imageResponse = () => new Response(new Blob(['image'], { type: 'image/png' }), {
  headers: { 'Content-Type': 'image/png' },
})

beforeEach(() => {
  let next = 0
  URL.createObjectURL = vi.fn(() => `blob:image-${++next}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('protected image lifecycle', () => {
  it('isolates a late response after identity and house changes and releases every Blob URL', async () => {
    let resolveOld!: (value: Response) => void
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve }))
      .mockImplementation(() => Promise.resolve(imageResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const admin = { ...viewerIdentity, role: 'ADMIN' as const }
    const { result, rerender, unmount } = renderHook(
      ({ urls, identity, version }) => useProtectedImages(urls, identity, version),
      { initialProps: { urls: [path], identity: viewerIdentity, version: 0 } },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const oldSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal
    rerender({ urls: [path], identity: admin, version: 1 })
    expect(oldSignal.aborted).toBe(true)
    await waitFor(() => expect(result.current.imageFor(path)).toEqual({ kind: 'ready', src: 'blob:image-1' }))
    resolveOld(imageResponse())
    await waitFor(() => expect(result.current.imageFor(path)).toEqual({ kind: 'ready', src: 'blob:image-1' }))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    rerender({ urls: [otherPath], identity: admin, version: 1 })
    expect(result.current.imageFor(otherPath).kind).toBe('loading')
    await waitFor(() => expect(result.current.imageFor(otherPath)).toEqual({ kind: 'ready', src: 'blob:image-2' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-2')
  })

  it('retries only the failed image without reloading another ready photo', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockImplementation(() => Promise.resolve(imageResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProtectedImages([path, otherPath], viewerIdentity, 0))
    await waitFor(() => expect(result.current.imageFor(path).kind).toBe('error'))
    await waitFor(() => expect(result.current.imageFor(otherPath).kind).toBe('ready'))
    act(() => result.current.retry(path))
    await waitFor(() => expect(result.current.imageFor(path).kind).toBe('ready'))
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([path, otherPath, path])
  })
})
