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
  method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; data: unknown }> {
  if (!path.startsWith('/api/')) throw new ApiError('Business API requests must use a local /api/ path.')
  const headers = apiIdentityHeaders(identity)
  let response: Response
  try {
    response = await fetch(path, {
      signal: signal ?? null,
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError('Could not reach the backend. Check that the API server is running.')
  }

  if (!response.ok) {
    const message = response.status === 401
      ? 'The current demo identity was not accepted (HTTP 401).'
      : response.status === 403
        ? 'The current demo identity is not permitted to perform this action (HTTP 403).'
        : response.status === 400
          ? 'The backend rejected the submitted details (HTTP 400). Review the form and try again.'
        : response.status === 404
          ? 'The requested resource was not found (HTTP 404).'
          : `The API request failed (HTTP ${response.status}).`
    throw new ApiError(message, response.status)
  }

  try {
    return { status: response.status, data: await response.json() as unknown }
  } catch {
    throw new ApiError('The backend returned invalid JSON.')
  }
}

export async function getJson(path: string, signal: AbortSignal | undefined, identity: DemoIdentity): Promise<unknown> {
  return (await requestJson(path, signal, identity, 'GET')).data
}

export function postJson(path: string, body: unknown, signal: AbortSignal | undefined,
  identity: DemoIdentity): Promise<{ status: number; data: unknown }> {
  return requestJson(path, signal, identity, 'POST', body)
}
