import { isDeepStrictEqual } from 'node:util'

/** Replace model records, never mutate records retained by an in-flight snapshot. */
export class CatalogOverlay {
  constructor(tables) {
    this.tables = tables
    this.originals = new Map()
    this.applied = new Map()
  }

  set(provider, models) {
    const table = this.tables[provider]
    const next = new Map(models.map(model => [model.id, model]))
    const previous = this.applied.get(provider) ?? new Map()
    if (isDeepStrictEqual(previous, next)) return false
    let originals = this.originals.get(provider)
    if (!originals) this.originals.set(provider, originals = new Map())
    for (const [id, model] of previous) {
      if (!next.has(id) && table[id] === model) this.restoreKey(table, id, originals.get(id))
    }
    for (const [id, model] of next) {
      if (!originals.has(id)) originals.set(id, Object.getOwnPropertyDescriptor(table, id))
      Object.defineProperty(table, id, { value: model, configurable: true, writable: true, enumerable: true })
    }
    this.applied.set(provider, next)
    return true
  }

  restoreKey(table, id, descriptor) {
    if (descriptor) Object.defineProperty(table, id, descriptor)
    else delete table[id]
  }

  restore() {
    let changed = false
    for (const [provider, models] of this.applied) for (const [id, model] of models) {
      if (this.tables[provider][id] !== model) continue
      this.restoreKey(this.tables[provider], id, this.originals.get(provider).get(id))
      changed = true
    }
    this.applied.clear()
    this.originals.clear()
    return changed
  }
}
