// Development-only simulated identity. The backend does not provide login yet.
export const demoIdentity = {
  user: 'frontend-demo',
  role: 'VIEWER',
  community: 'Austin Council District 8',
} as const

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      signal: signal ?? null,
      headers: {
        Accept: 'application/json',
        'X-User': demoIdentity.user,
        'X-Role': demoIdentity.role,
        'X-Community': demoIdentity.community,
      },
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError('Could not reach the backend. Check that the API server is running.')
  }

  if (!response.ok) {
    const message = response.status === 401
      ? 'The demo identity is invalid (HTTP 401).'
      : response.status === 403
        ? 'The demo identity is not allowed to read house data (HTTP 403).'
        : `House data could not be loaded (HTTP ${response.status}).`
    throw new ApiError(message, response.status)
  }

  try {
    return await response.json() as unknown
  } catch {
    throw new ApiError('The backend returned invalid JSON.')
  }
}
