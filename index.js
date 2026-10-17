import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { dshCachePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { CatalogCache } from './lib/cache.js'
import { CatalogController } from './lib/controller.js'
import { configuredProviders, generatedAt, invalidateCatalog, tables } from './lib/dsh-bridge.js'

export const name = 'model-catalog'
export const inject = ['llm']
export const Config = z.object({
  cacheDir: z.string().default(dshCachePath('model-catalog')),
  offline: z.boolean().default(false),
})

let installation

export async function apply(ctx, config) {
  const cacheDir = resolve(expandHomePath(config.cacheDir))
  const key = JSON.stringify([cacheDir, config.offline])
  let current
  ctx.effect(() => {
    if (installation && installation.key !== key) throw new Error('model-catalog instances in one process must use the same cacheDir and offline settings')
    if (!installation) {
      const controller = new CatalogController({
        tables, generatedAt, cache: new CatalogCache(cacheDir), offline: config.offline,
        providers: configuredProviders, invalidate: invalidateCatalog,
        log: (level, message) => [...controller.contexts][0]?.logger[level](message),
      })
      installation = { key, controller }
    }
    current = installation.controller
    current.contexts.add(ctx)
    current.roots.add(ctx.root)
    return () => {
      if (current.contexts.size !== 1) { current.contexts.delete(ctx); return }
      const stopped = current.stop()
      current.contexts.delete(ctx)
      installation = undefined
      return stopped
    }
  }, 'model-catalog runtime overlay')
  invalidateCatalog([ctx.root])
  ctx.on('llm/adapters-updated', () => current.refreshNewProviders())
  ctx.inject(['commands'], child => child.commands.register({
    name: 'models-refresh',
    description: 'Refresh the Pi model catalog without changing model selection or credentials',
    async handler({ signal }) {
      signal.throwIfAborted()
      const results = await current.refresh(true)
      signal.throwIfAborted()
      const failed = results.filter(result => result.status === 'failed').map(result => result.provider)
      return failed.length
        ? { kind: 'error', text: `Catalog refresh failed for ${failed.join(', ')}. Retained the available catalog.` }
        : { kind: 'success', text: config.offline ? 'Offline model catalog loaded.' : `Model catalog checked for ${results.length} provider(s).` }
    },
  }))
  await current.start()
}
