/**
 * dsh-knowledge-base — conversation buffer for the daily digest.
 *
 * Every turn end appends the turn's material here; nothing is summarised at
 * that moment. The scheduled daily task reads the buffer, distils knowledge
 * points, stores them for review, and clears it.
 *
 * The buffer lives next to `kb.json`, is plain JSON (never contains secrets —
 * callers pre-filter), and is bounded so a quiet month cannot grow forever.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const VERSION = 1
const MAX_ENTRIES = 600
const MAX_CHARS = 300_000
const MAX_AGE_MS = 72 * 60 * 60 * 1000

function keyOf(item) {
  return `${item.session}\u0000${item.text}`
}

function normalize(value) {
  if (value === null || typeof value !== 'object') return { version: VERSION, updatedAt: null, entries: [] }
  const entries = Array.isArray(value.entries)
    ? value.entries
        .filter(
          (item) =>
            item !== null &&
            typeof item === 'object' &&
            typeof item.session === 'string' &&
            typeof item.text === 'string' &&
            item.text.trim() !== '',
        )
        .map((item) => ({
          session: item.session,
          role: item.role === 'assistant' ? 'assistant' : 'user',
          text: item.text,
          time: Number(item.time ?? 0) || Date.now(),
        }))
    : []
  return {
    version: VERSION,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    entries,
  }
}

function prune(state, now) {
  let entries = state.entries.filter((item) => now - item.time < MAX_AGE_MS)
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  let chars = 0
  const kept = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index]
    chars += item.text.length
    if (chars > MAX_CHARS) break
    kept.push(item)
  }
  state.entries = kept.reverse()
  return state
}

/**
 * @param {string} file absolute path of the buffer file
 */
export function createBuffer(file) {
  let state = { version: VERSION, updatedAt: null, entries: [] }
  let loaded = false
  let chain = Promise.resolve()

  async function load() {
    if (loaded) return state
    loaded = true
    try {
      state = normalize(JSON.parse(await readFile(file, 'utf8')))
    } catch (error) {
      // A missing or unreadable buffer is simply empty.
      if (error?.code !== 'ENOENT') state = normalize(null)
    }
    return state
  }

  async function persist() {
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    await writeFile(temp, JSON.stringify(state), 'utf8')
    await rename(temp, file)
  }

  return {
    file,

    /** Add the material of one turn; identical lines are not duplicated. */
    append(items) {
      chain = chain.then(async () => {
        await load()
        const seen = new Set(state.entries.map(keyOf))
        let added = 0
        const now = Date.now()
        for (const item of items) {
          if (item === null || typeof item !== 'object') continue
          if (typeof item.text !== 'string' || item.text.trim() === '') continue
          const entry = {
            session: String(item.session ?? ''),
            role: item.role === 'assistant' ? 'assistant' : 'user',
            text: item.text,
            time: Number(item.time ?? 0) || now,
          }
          const key = keyOf(entry)
          if (seen.has(key)) continue
          seen.add(key)
          state.entries.push(entry)
          added += 1
        }
        prune(state, now)
        state.updatedAt = new Date(now).toISOString()
        if (added > 0) await persist()
        return added
      })
      return chain
    },

    /** Snapshot for the daily task. */
    async read() {
      await chain
      await load()
      prune(state, Date.now())
      const entries = state.entries.map((item) => ({ ...item }))
      return {
        entries,
        chars: entries.reduce((sum, item) => sum + item.text.length, 0),
        sessions: [...new Set(entries.map((item) => item.session))],
        updatedAt: state.updatedAt,
        file,
      }
    },

    async clear() {
      chain = chain.then(async () => {
        await load()
        const removed = state.entries.length
        state = { version: VERSION, updatedAt: new Date().toISOString(), entries: [] }
        await persist()
        return removed
      })
      return chain
    },
  }
}
