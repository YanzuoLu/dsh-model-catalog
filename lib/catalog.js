export const CATALOG_BASE_URL = 'https://pi.dev'
export const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

export class CatalogError extends Error {}

/** Preserve Pi's accepted response shapes and provider identity. */
export function parseCatalog(provider, value) {
  const entries = Array.isArray(value) ? value
    : Array.isArray(value?.models) ? value.models
      : value && typeof value === 'object' ? Object.values(value) : undefined
  if (!entries) throw new CatalogError(`Invalid model catalog for ${provider}`)
  return entries.filter(model => model && typeof model === 'object' && 'id' in model).map(model => {
    if (typeof model.id !== 'string' || !model.id) throw new CatalogError(`Invalid model ID for ${provider}`)
    return { ...model, provider }
  })
}

/** An online catalog may overlay the bundle only when it is demonstrably newer. */
export function remoteModels(entry, generatedAt) {
  if (!entry || generatedAt !== undefined && (entry.lastModified === undefined || entry.lastModified <= generatedAt)) return []
  return entry.models
}

/** Three bounded attempts, matching Pi's idempotent management-request retry policy. */
async function request(url, headers, signal, fetchFn) {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted()
    const timeout = AbortSignal.timeout(4000)
    let response
    try {
      response = await fetchFn(url, { headers, signal: AbortSignal.any([signal, timeout]) })
    } catch (error) {
      signal.throwIfAborted()
      if (attempt === 2 || error.name === 'AbortError' && !timeout.aborted) {
        throw new CatalogError('Model catalog connection failed', { cause: error })
      }
      continue
    }
    if (!RETRYABLE.has(response.status) || attempt === 2) return response
    try { await response.body?.cancel() } catch { /* Discarded response. */ }
  }
}

/** Return a cache update and, when applicable, a new runtime overlay. */
export async function refreshCatalog(provider, stored, {
  signal, generatedAt, force = false, now = Date.now,
  fetchFn = (...args) => globalThis.fetch(...args),
}) {
  if (!force && stored?.checkedAt !== undefined && stored.lastModified !== undefined
    && now() - stored.checkedAt < REFRESH_INTERVAL_MS) return { status: 'cached' }
  const validator = stored?.models.length ? stored.etag : undefined
  const response = await request(new URL(`/api/models/providers/${encodeURIComponent(provider)}`, CATALOG_BASE_URL), {
    accept: 'application/json',
    'User-Agent': 'dsh-model-catalog/0.1.0',
    ...(validator ? { 'if-none-match': validator } : {}),
  }, signal, fetchFn)
  signal.throwIfAborted()
  const checkedAt = now()
  if (response.status === 304 && stored) return { status: 'not-modified', entry: { ...stored, checkedAt } }
  if (response.status === 404 || response.status === 501) return {
    status: 'unavailable',
    entry: { ...(stored ?? { models: [] }), checkedAt, lastModified: 0, etag: undefined },
  }
  if (!response.ok) return {
    status: 'failed', error: new CatalogError(`Model catalog HTTP ${response.status} for ${provider}`),
    entry: { ...(stored ?? { models: [] }), checkedAt },
  }
  let value
  try { value = await response.json() } catch (error) {
    signal.throwIfAborted()
    throw new CatalogError(`Unreadable model catalog for ${provider}`, { cause: error })
  }
  const models = parseCatalog(provider, value)
  const modified = Date.parse(response.headers.get('last-modified') ?? '')
  const entry = { models, checkedAt, lastModified: Number.isNaN(modified) ? 0 : modified, etag: response.headers.get('etag') ?? undefined }
  return { status: 'updated', entry, models: remoteModels(entry, generatedAt) }
}
