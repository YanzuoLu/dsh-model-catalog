import { Context, symbols } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModelDataGeneratedAt } from '@earendil-works/pi-ai/providers/all'

// Version-bound seams for dsh 0.2.0-rc.2 and pi-ai 0.87.1.
// No installed files are changed and dsh still owns all route normalization.
const { MODELS } = await import(new URL('../models.generated.js', import.meta.resolve('@earendil-works/pi-ai/providers/all')).href)
export const tables = MODELS
export const generatedAt = getBuiltinModelDataGeneratedAt()

function fibers(contexts) {
  return new Set([...contexts].flatMap(ctx => [...ctx.registry.get(piAi)?.fibers ?? []])
    .filter(fiber => fiber.uid !== null && fiber.config?.providers))
}

export function configuredProviders(contexts) {
  return [...new Set([...fibers(contexts)].flatMap(fiber => Object.keys(fiber.config.providers.get() ?? {})))]
    .filter(provider => provider !== 'radius' && Object.hasOwn(MODELS, provider)).sort()
}

/** Same config values, fresh immutable identity, then the host's normal notifications. */
export function invalidateCatalog(contexts) {
  const owners = fibers(contexts)
  for (const fiber of owners) updateVolatile(fiber.config.providers, createVolatile(fiber.config.providers.get()))
  const llms = new Set()
  for (const fiber of owners) {
    const scope = Object.create(fiber.ctx)
    scope[Context.filter] = owner => owner.fiber === fiber
    fiber.ctx.emit(scope, 'loader/volatile-update', [['providers']])
    const llm = fiber.ctx.get('llm')
    if (llm) llms.add(llm[symbols.original] ?? llm)
  }
  for (const llm of llms) llm.emitAdaptersUpdated()
}
