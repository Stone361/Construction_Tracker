import { useEffect, useRef, useState } from 'react'
import type { DemoIdentity } from '../app/DemoIdentityContext'
import { getProtectedImage } from './apiClient'

export type ProtectedImageState =
  | { kind: 'loading' }
  | { kind: 'ready'; src: string }
  | { kind: 'error'; message: string }

/** One request and one Blob URL per distinct file URL, shared by all views of that image. */
export function useProtectedImages(urls: (string | null)[], identity: DemoIdentity, version: number) {
  const urlsKey = JSON.stringify([...new Set(urls.filter((url): url is string => url !== null))])
  const key = JSON.stringify([urlsKey, version, identity.user, identity.role, identity.community])
  const [result, setResult] = useState<{ key: string; images: Record<string, ProtectedImageState> }>(
    { key: '', images: {} },
  )
  const loadRef = useRef<((url: string) => void) | null>(null)

  useEffect(() => {
    const paths = JSON.parse(urlsKey) as string[]
    const pending = new Map<string, AbortController>()
    const objectUrls = new Map<string, string>()
    let active = true
    const update = (url: string, image: ProtectedImageState) => {
      if (!active) return
      setResult(current => ({ key, images: { ...(current.key === key ? current.images : {}), [url]: image } }))
    }
    const load = (url: string) => {
      if (!paths.includes(url)) return
      pending.get(url)?.abort()
      const old = objectUrls.get(url)
      if (old) URL.revokeObjectURL(old)
      objectUrls.delete(url)
      const controller = new AbortController()
      pending.set(url, controller)
      update(url, { kind: 'loading' })
      getProtectedImage(url, controller.signal, identity).then(blob => {
        if (!active || controller.signal.aborted || pending.get(url) !== controller) return
        const src = URL.createObjectURL(blob)
        objectUrls.set(url, src)
        update(url, { kind: 'ready', src })
      }, error => {
        if (!active || controller.signal.aborted || pending.get(url) !== controller) return
        update(url, { kind: 'error', message: error instanceof Error ? error.message : 'The photo could not be loaded.' })
      })
    }
    loadRef.current = load
    // StrictMode replays mount effects in development. Defer the first fetch so
    // its discarded setup cannot issue duplicate image requests.
    queueMicrotask(() => { if (active) paths.forEach(load) })
    return () => {
      active = false
      loadRef.current = null
      pending.forEach(controller => controller.abort())
      objectUrls.forEach(src => URL.revokeObjectURL(src))
    }
  }, [identity, key, urlsKey])

  const imageFor = (url: string | null): ProtectedImageState => {
    if (!url) return { kind: 'error', message: 'The photo file URL is unavailable.' }
    return result.key === key ? result.images[url] ?? { kind: 'loading' } : { kind: 'loading' }
  }
  return { imageFor, retry: (url: string | null) => { if (url) loadRef.current?.(url) } }
}
