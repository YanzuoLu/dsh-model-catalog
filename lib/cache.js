import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CatalogError, parseCatalog } from './catalog.js'

/** Public metadata only. Separate atomic files avoid cross-provider lost updates. */
export class CatalogCache {
  constructor(directory) { this.directory = directory }
  path(provider) { return join(this.directory, `${encodeURIComponent(provider)}.json`) }

  async read(provider) {
    let text
    try { text = await readFile(this.path(provider), 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
    const entry = JSON.parse(text)
    if (!entry || !Array.isArray(entry.models)
      || ['checkedAt', 'lastModified'].some(key => entry[key] !== undefined && !Number.isFinite(entry[key]))
      || entry.etag !== undefined && typeof entry.etag !== 'string') {
      throw new CatalogError(`Invalid model cache for ${provider}`)
    }
    return { ...entry, models: parseCatalog(provider, entry.models) }
  }

  async write(provider, entry) {
    await mkdir(this.directory, { recursive: true })
    const target = this.path(provider)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(entry) + '\n')
      await rename(temporary, target)
    } finally {
      try { await unlink(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
}
