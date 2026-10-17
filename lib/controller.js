import { CatalogError, REFRESH_INTERVAL_MS, refreshCatalog, remoteModels } from './catalog.js'
import { CatalogOverlay } from './overlay.js'

function cacheFailure(error) {
  return error instanceof SyntaxError || error instanceof CatalogError || typeof error.syscall === 'string'
}

/** One process-wide catalog owner, shared by Cordis instances using the same configuration. */
export class CatalogController {
  constructor({ tables, generatedAt, cache, offline, providers, invalidate, log, fetchFn }) {
    Object.assign(this, { generatedAt, cache, offline, providers, invalidate, log, fetchFn })
    this.overlay = new CatalogOverlay(tables)
    this.contexts = new Set()
    this.roots = new Set()
    this.entries = new Map()
    this.flights = new Map()
    this.abort = new AbortController()
  }

  start() {
    if (!this.timer && !this.offline) {
      this.timer = setInterval(() => { this.refresh().catch(error => this.log('error', error)) }, REFRESH_INTERVAL_MS)
      this.timer.unref()
    }
    return this.refresh()
  }

  refreshNewProviders() {
    if (this.providers(this.contexts).join('\n') !== this.providerKey) return this.refresh()
  }

  refresh(force = false) {
    if (this.abort.signal.aborted) return Promise.resolve([])
    const providers = this.providers(this.contexts)
    this.providerKey = providers.join('\n')
    return Promise.all(providers.map(provider => this.singleFlight(provider, force)))
  }

  singleFlight(provider, force) {
    if (this.abort.signal.aborted) return Promise.resolve({ provider, status: 'cancelled' })
    const running = this.flights.get(provider)
    if (running) return force
      ? running.then(result => result.status === 'cached' ? this.singleFlight(provider, true) : result)
      : running
    const pending = this.refreshProvider(provider, force).finally(() => this.flights.delete(provider))
    this.flights.set(provider, pending)
    return pending
  }

  publish(provider, models) {
    if (!this.abort.signal.aborted && this.overlay.set(provider, models)) this.invalidate(this.roots)
  }

  async refreshProvider(provider, force) {
    const signal = this.abort.signal
    let stored = this.entries.get(provider)
    try {
      const cached = await this.cache.read(provider)
      if (cached && (!stored || (cached.lastModified ?? 0) >= (stored.lastModified ?? 0))) stored = cached
    } catch (error) {
      if (!cacheFailure(error)) throw error
      this.log('warn', `model-catalog: cache read for ${provider} failed (${error.message})`)
    }
    if (signal.aborted) return { provider, status: 'cancelled' }
    if (stored) this.entries.set(provider, stored)
    this.publish(provider, remoteModels(stored, this.generatedAt))
    if (this.offline) return { provider, status: 'offline' }
    let result
    try {
      result = await refreshCatalog(provider, stored, { signal, generatedAt: this.generatedAt, force, fetchFn: this.fetchFn })
    } catch (error) {
      if (signal.aborted) return { provider, status: 'cancelled' }
      if (!(error instanceof CatalogError)) throw error
      result = { status: 'failed', error }
    }
    if (signal.aborted) return { provider, status: 'cancelled' }
    if (result.entry) {
      this.entries.set(provider, result.entry)
      try { await this.cache.write(provider, result.entry) } catch (error) {
        if (!cacheFailure(error)) throw error
        this.log('warn', `model-catalog: cache write for ${provider} failed (${error.message})`)
      }
    }
    if (result.models) this.publish(provider, result.models)
    if (result.error) this.log('warn', `model-catalog: ${result.error.message}`)
    return { provider, status: signal.aborted ? 'cancelled' : result.status }
  }

  stop() {
    this.abort.abort()
    clearInterval(this.timer)
    if (this.overlay.restore()) this.invalidate(this.roots)
    return Promise.allSettled(this.flights.values())
  }
}
