import { afterEach, describe, expect, it, vi } from 'vitest'
import { advanceHouse } from './advanceHouse'
import type { DemoIdentity } from '../app/DemoIdentityContext'

const admin: DemoIdentity = { user: 'frontend-demo', role: 'ADMIN', community: null }
const manager: DemoIdentity = { user: 'frontend-demo', role: 'SITE_MANAGER', community: 'North Austin' }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('stage advance API', () => {
  it('sends one adjacent-stage POST with the current identity and does not retry it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 12, stage: 'FRAMING' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await advanceHouse(12, 'FOUNDATION', 'FRAMING', manager)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/houses/12/advance')
    expect(options.method).toBe('POST')
    expect(options.signal).toBeNull()
    expect(options.headers).toMatchObject({ 'X-User': 'frontend-demo', 'X-Role': 'SITE_MANAGER',
      'X-Community': 'North Austin' })
    expect(JSON.parse(options.body as string)).toEqual({ fromStage: 'FOUNDATION', toStage: 'FRAMING' })
  })

  it('rejects invalid or skipped transitions before sending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(advanceHouse(12, 'FOUNDATION', 'MEP', admin)).rejects.toThrow(/next stage/)
    await expect(advanceHouse(0, 'FOUNDATION', 'FRAMING', admin)).rejects.toThrow(/valid house/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([[409, '当前施工阶段已变化'], [422, '当前施工阶段缺少非 SUSPECT 的照片']] as const)(
    'preserves backend business detail for HTTP %i', async (status, reason) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: status === 409 ? 'CONFLICT' : 'BUSINESS_RULE_VIOLATION', message: reason,
      }), { status, headers: { 'Content-Type': 'application/json' } })))
      await expect(advanceHouse(12, 'FOUNDATION', 'FRAMING', admin))
        .rejects.toMatchObject({ status, message: expect.stringContaining(reason) })
    })

  it.each([401, 403])('keeps HTTP %i distinct from an uncertain network result', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    await expect(advanceHouse(12, 'FOUNDATION', 'FRAMING', admin)).rejects.toMatchObject({ status })
  })

  it('treats a lost or invalid acknowledgement as unknown and never repeats the POST', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(advanceHouse(12, 'FOUNDATION', 'FRAMING', admin)).rejects.toThrow(/result is unknown/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(advanceHouse(12, 'FOUNDATION', 'FRAMING', admin)).rejects.toThrow(/result is unknown/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('times out the UI wait without resending the write and signals a late settlement', async () => {
    vi.useFakeTimers()
    let finish!: (response: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const lateSettle = vi.fn()
    const advance = advanceHouse(12, 'FOUNDATION', 'FRAMING', admin, lateSettle)
    const rejection = expect(advance).rejects.toThrow(/result is unknown/)
    await vi.advanceTimersByTimeAsync(20000)
    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lateSettle).not.toHaveBeenCalled()
    finish(new Response(JSON.stringify({ id: 12, stage: 'FRAMING' }), { status: 200 }))
    await vi.waitFor(() => expect(lateSettle).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
