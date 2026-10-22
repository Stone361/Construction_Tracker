import type { DemoIdentity } from '../app/DemoIdentityContext'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export function apiIdentityHeaders(identity: DemoIdentity): Record<string, string> {
  if (!identity.user.trim() || !['ADMIN', 'SITE_MANAGER', 'VIEWER'].includes(identity.role) ||
      (identity.role === 'SITE_MANAGER' && (!identity.community || identity.community.trim() !== identity.community))) {
    throw new ApiError('The current demo identity is incomplete (HTTP 401).', 401)
  }
  return {
    'X-User': identity.user,
    'X-Role': identity.role,
    ...(identity.role === 'SITE_MANAGER' ? { 'X-Community': identity.community! } : {}),
  }
}

async function requestJson(path: string, signal: AbortSignal | undefined, identity: DemoIdentity,
  method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<{ status: number; data: unknown }> {
  if (!path.startsWith('/api/')) throw new ApiError('Business API requests must use a local /api/ path.')
  const headers = apiIdentityHeaders(identity)
  let response: Response
  try {
    response = await fetch(path, {
      signal: signal ?? null,
      method,
      headers: {
        Accept: 'application/json',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError('Could not reach the backend. Check that the API server is running.')
  }

  if (!response.ok) {
    let detail: string | null = null
    if (response.status === 409 || response.status === 422) {
      try {
        const body = await response.json() as unknown
        if (typeof body === 'object' && body !== null && 'message' in body &&
            typeof body.message === 'string' && body.message.trim()) detail = body.message.trim()
      } catch { /* Fall back to the HTTP status when the error body is unavailable. */ }
    }
    const message = response.status === 401
      ? 'The current demo identity was not accepted (HTTP 401).'
      : response.status === 403
        ? 'The current demo identity is not permitted to perform this action (HTTP 403).'
        : response.status === 400
          ? 'The backend rejected the submitted details (HTTP 400). Review the form and try again.'
        : response.status === 404
          ? 'The requested resource was not found (HTTP 404).'
        : response.status === 409
          ? 'The house stage has changed (HTTP 409).'
        : response.status === 422
          ? 'The operation does not satisfy a business rule (HTTP 422).'
          : `The API request failed (HTTP ${response.status}).`
    throw new ApiError(`${message}${detail ? ` ${detail}` : ''}`, response.status)
  }

  try {
    return { status: response.status, data: await response.json() as unknown }
  } catch {
    throw new ApiError('The backend returned invalid JSON.')
  }
}

/** Protected binary requests use the same local-only identity boundary as JSON requests. */
export async function getProtectedImage(path: string, signal: AbortSignal, identity: DemoIdentity): Promise<Blob> {
  if (!/^\/api\/houses\/[1-9]\d*\/photos\/[1-9]\d*\/file$/.test(path)) {
    throw new ApiError('The photo file URL is invalid.')
  }
  const headers = apiIdentityHeaders(identity)
  let response: Response
  try {
    response = await fetch(path, { signal, headers: { Accept: 'image/jpeg, image/png, image/webp', ...headers } })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ApiError('Could not reach the backend. Check that the API server is running.')
  }
  if (!response.ok) {
    const message = response.status === 401 ? 'The current demo identity was not accepted (HTTP 401).'
      : response.status === 403 ? 'The current demo identity is not permitted to read this photo (HTTP 403).'
        : response.status === 404 ? 'This photo file was not found (HTTP 404).'
          : `The photo could not be loaded (HTTP ${response.status}).`
    throw new ApiError(message, response.status)
  }
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
    throw new ApiError('The backend returned an invalid photo file type.')
  }
  const blob = await response.blob()
  if (!blob.size) throw new ApiError('The backend returned an empty photo file.')
  return blob
}

/** Do not set Content-Type: the browser must add the multipart boundary. */
export async function postMultipart(path: string, form: FormData, identity: DemoIdentity): Promise<{ status: number; data: unknown }> {
  if (!/^\/api\/houses\/[1-9]\d*\/photos$/.test(path)) throw new ApiError('The photo upload URL is invalid.')
  const headers = apiIdentityHeaders(identity)
  let response: Response
  try {
    response = await fetch(path, { method: 'POST', headers: { Accept: 'application/json', ...headers }, body: form })
  } catch {
    throw new ApiError('The upload result is unknown. Check the house details before trying again.')
  }
  if (!response.ok) {
    let detail: string | null = null
    try {
      const body = await response.json() as unknown
      if (typeof body === 'object' && body !== null && 'message' in body &&
          typeof body.message === 'string' && body.message.trim()) detail = body.message.trim()
    } catch { /* A response body is not required for an HTTP error. */ }
    const label = response.status === 401 ? 'The current demo identity was not accepted'
      : response.status === 403 ? 'This identity cannot upload to this house'
        : response.status === 413 ? 'The photo is too large'
          : response.status === 415 ? 'The photo format is not supported'
            : response.status === 422 ? 'The photo did not satisfy a business rule'
              : 'The photo upload was rejected'
    throw new ApiError(`${label} (HTTP ${response.status}).${detail ? ` ${detail}` : ''}`, response.status)
  }
  let data: unknown
  try { data = await response.json() as unknown }
  catch { throw new ApiError('The upload may have succeeded, but the response was invalid. Refresh details before trying again.') }
  return { status: response.status, data }
}

export async function getJson(path: string, signal: AbortSignal | undefined, identity: DemoIdentity): Promise<unknown> {
  return (await requestJson(path, signal, identity, 'GET')).data
}

export function postJson(path: string, body: unknown, signal: AbortSignal | undefined,
  identity: DemoIdentity): Promise<{ status: number; data: unknown }> {
  return requestJson(path, signal, identity, 'POST', body)
}

export function putJson(path: string, body: unknown, identity: DemoIdentity): Promise<{ status: number; data: unknown }> {
  return requestJson(path, undefined, identity, 'PUT', body)
}
