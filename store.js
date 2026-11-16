/**
 * dsh-knowledge-base — storage, retrieval, and encryption.
 *
 * Pure Node (only `node:` builtins), so the Host half can import it without a
 * profile dependency and tests can drive it directly.
 *
 * At rest the document is one of two shapes:
 *
 *   plaintext (legacy / not yet protected):
 *     { "version": 2, "settings": { "recall": true }, "entries": [...] }
 *
 *   encrypted envelope (after the user sets a passphrase):
 *     { "version": 2, "encrypted": true, "alg": "dsh-kb-aes-256-gcm",
 *       "kdf": { "name": "scrypt", "N": 16384, "r": 8, "p": 1, "salt": "..." },
 *       "iv": "...", "tag": "...", "data": "..." }
 *
 * The key is derived from the passphrase with scrypt and lives only in memory.
 * Locking drops it (filled with zeros) and the plaintext document, so a locked
 * process exposes neither to tools nor to the system prompt. The passphrase is
 * never written to disk.
 *
 * Writes go through one serialized promise chain using temp-file + rename.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DATA_VERSION = 2
export const ENVELOPE_ALG = 'dsh-kb-aes-256-gcm'
export const MIN_PASSPHRASE = 8

const MAX_TITLE = 200
const MAX_SOURCE = 400
const MAX_CONTENT = 400_000
const MAX_TAGS = 24

const KDF = { N: 16_384, r: 8, p: 1 }
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12

/** Anything that looks like a credential is hidden from prompts by default. */
const SECRET_PATTERN =
  /(密码|口令|密钥|私钥|令牌|验证码|恢复码|secret|passw(?:or)?d|api[_-]?key|access[_-]?key|token)/iu

/**
 * A bare mention is not a secret: "接口不能用口令绕过" is knowledge, while
 * "密码是 Passw0rd" is a credential. Digest notes only use this stricter rule,
 * so a note that merely talks about passwords stays searchable.
 */
const SECRET_VALUE_PATTERN =
  /(密码|口令|密钥|私钥|令牌|验证码|恢复码|secret|passw(?:or)?d|api[_-]?key|access[_-]?key|token)\s*(?:是|为|＝|=|:|：)\s*\S{2,}/iu

/** Where the knowledge base lives unless the caller supplies a path. */
export function defaultDataFile() {
  const base = process.env.DSH_PROFILE_DIR || process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(base, 'knowledge-base', 'kb.json')
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function text(value) {
  return asString(value).replace(/\r\n?/gu, '\n').trim()
}

function requireText(value, label, max) {
  const body = text(value)
  if (body === '') throw new Error(`${label}不能为空`)
  return body.length > max ? body.slice(0, max) : body
}

/** Accept an array or a comma / 顿号 / semicolon separated string. */
export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，、;；\n]+/u)
      : []
  const out = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.trim().slice(0, 40)
    if (tag === '' || out.includes(tag)) continue
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

/** Auto-classify entries that look like they hold credentials. */
export function looksSensitive(title, content) {
  return SECRET_PATTERN.test(`${asString(title)}\n${asString(content)}`)
}

/** Stricter: only a credential word that carries an actual value counts. */
export function looksSensitiveValue(title, content) {
  return SECRET_VALUE_PATTERN.test(`${asString(title)}\n${asString(content)}`)
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? Math.round(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function truncate(value, max) {
  if (!Number.isFinite(max) || max <= 0 || value.length <= max) return value
  return `${value.slice(0, max)}\n…（已截断）`
}

/** Lowercased latin words plus CJK bigrams: enough for mixed Chinese/English. */
export function tokensOf(input) {
  const lower = asString(input).toLowerCase()
  const out = new Set()
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9._+-]*/gu)) {
    if (match[0].length >= 2) out.add(match[0])
  }
  for (const run of lower.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) ?? []) {
    if (run.length === 1) {
      out.add(run)
    } else {
      for (let i = 0; i < run.length - 1; i += 1) out.add(run.slice(i, i + 2))
    }
  }
  return [...out]
}

function scoreEntry(entry, tokens, phrase) {
  const title = entry.title.toLowerCase()
  const tags = entry.tags.join(' ').toLowerCase()
  const source = entry.source.toLowerCase()
  const content = entry.content.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (title.includes(token)) score += 6
    if (tags.includes(token)) score += 5
    if (source.includes(token)) score += 2
    if (content.includes(token)) score += 2
  }
  if (phrase.length >= 2) {
    if (title.includes(phrase)) score += 12
    if (tags.includes(phrase)) score += 6
    if (content.includes(phrase)) score += 4
  }
  return score
}

function emptyState() {
  return {
    version: DATA_VERSION,
    settings: {
      recall: true,
      reflux: { lastRunAt: null, lastSummary: '' },
    },
    entries: [],
  }
}

function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const title = text(raw.title)
  const content = text(raw.content)
  if (title === '' || content === '') return undefined
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt !== '' ? raw.createdAt : new Date().toISOString()
  const explicit = raw.sensitive === true || raw.sensitive === false ? raw.sensitive : undefined
  return {
    id: text(raw.id) === '' ? undefined : text(raw.id),
    title: title.slice(0, MAX_TITLE),
    content: content.slice(0, MAX_CONTENT),
    tags: normalizeTags(raw.tags),
    source: text(raw.source).slice(0, MAX_SOURCE),
    sensitive: explicit === undefined ? looksSensitive(title, content) : explicit,
    // "confirmed" entries answer queries; "pending" reflux waits for a human.
    state: raw.state === 'pending' ? 'pending' : 'confirmed',
    origin: raw.origin === 'reflux' ? 'reflux' : 'manual',
    sessionId: text(raw.sessionId).slice(0, 120) === '' ? undefined : text(raw.sessionId).slice(0, 120),
    reason: raw.reason === 'confirm' || raw.reason === 'change' ? raw.reason : undefined,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt !== '' ? raw.updatedAt : createdAt,
  }
}

function normalizeState(input) {
  const state = emptyState()
  if (input === null || typeof input !== 'object') return state
  if (input.settings !== null && typeof input.settings === 'object') {
    const settings = input.settings
    if (typeof settings.recall === 'boolean') state.settings.recall = settings.recall
    else if (typeof settings.gate === 'boolean') state.settings.recall = settings.gate
    if (settings.reflux !== null && typeof settings.reflux === 'object') {
      if (typeof settings.reflux.lastRunAt === 'string') state.settings.reflux.lastRunAt = settings.reflux.lastRunAt
      if (typeof settings.reflux.lastSummary === 'string') state.settings.reflux.lastSummary = settings.reflux.lastSummary
    }
  }
  if (Array.isArray(input.entries)) {
    for (const raw of input.entries) {
      const entry = normalizeEntry(raw)
      if (entry === undefined) continue
      if (entry.id === undefined) entry.id = `kb-${state.entries.length + 1}`
      state.entries.push(entry)
    }
  }
  return state
}

/* ------------------------------------------------------------------------- */
/* Envelope encryption                                                       */
/* ------------------------------------------------------------------------- */

function deriveKey(passphrase, salt) {
  return scryptSync(String(passphrase), salt, KEY_BYTES, { ...KDF, maxmem: 128 * 1024 * 1024 })
}

function sealDocument(document, key, salt) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(document), 'utf8')
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    version: DATA_VERSION,
    encrypted: true,
    alg: ENVELOPE_ALG,
    kdf: { name: 'scrypt', ...KDF, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Open an envelope with a passphrase.
 *
 * @returns {{ document: unknown, key: Buffer, salt: Buffer }}
 * @throws when the envelope is malformed or the passphrase is wrong.
 */
function openEnvelope(envelope, passphrase) {
  const salt = Buffer.from(String(envelope?.kdf?.salt ?? ''), 'base64')
  const iv = Buffer.from(String(envelope?.iv ?? ''), 'base64')
  const tag = Buffer.from(String(envelope?.tag ?? ''), 'base64')
  const data = Buffer.from(String(envelope?.data ?? ''), 'base64')
  if (salt.length < 8 || iv.length < 8 || tag.length !== 16 || data.length === 0) {
    throw new Error('知识库文件格式不正确')
  }
  const key = deriveKey(passphrase, salt)
  let plaintext
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    plaintext = Buffer.concat([decipher.update(data), decipher.final()])
  } catch {
    key.fill(0)
    throw new Error('口令不正确')
  }
  try {
    return { document: JSON.parse(plaintext.toString('utf8')), key, salt }
  } catch {
    key.fill(0)
    throw new Error('知识库内容损坏，无法解析')
  }
}

/**
 * Create the in-memory store backed by `dataFile`.
 *
 * @param {{ dataFile?: string, now?: () => Date, makeId?: () => string }} [options]
 */
export function createStore(options = {}) {
  const file = options.dataFile || defaultDataFile()
  const clock = options.now || (() => new Date())
  const makeId =
    options.makeId || (() => `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)

  let state = emptyState()
  let chain = Promise.resolve()
  let loadError = null
  /** The file holds an encrypted envelope. */
  let encrypted = false
  /** The in-memory document is readable right now. */
  let unlocked = false
  let key = null
  let salt = null
  let lastAccess = 0

  const iso = () => clock().toISOString()
  const lockedError = () => new Error('知识库已锁定：请在「设置 → 知识库」输入口令解锁。')
  const requireUnlocked = () => {
    if (encrypted && !unlocked) throw lockedError()
  }
  const touch = () => {
    lastAccess = Date.now()
  }

  function readEnvelope() {
    return JSON.parse(readFileSync(file, 'utf8'))
  }

  function load() {
    if (!existsSync(file)) {
      unlocked = true
      return
    }
    let parsed
    try {
      parsed = readEnvelope()
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error)
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        /* backup is best effort */
      }
      console.warn(`[knowledge-base] 无法读取 ${file}，已备份损坏文件并按空库启动：${loadError}`)
      unlocked = true
      return
    }
    if (parsed?.encrypted === true) {
      encrypted = true
      unlocked = false
      state = emptyState()
      return
    }
    if (parsed?.entries !== undefined) {
      // Legacy plaintext document: usable, but the UI asks for a passphrase.
      state = normalizeState(parsed)
      encrypted = false
      unlocked = true
      return
    }
    loadError = 'unrecognized document'
    encrypted = false
    unlocked = true
  }

  function persist() {
    requireUnlocked()
    const next = chain.then(async () => {
      const body = encrypted
        ? JSON.stringify(sealDocument(state, key, salt), null, 2)
        : JSON.stringify(state, null, 2)
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, file)
    })
    chain = next.catch(() => undefined)
    return next
  }

  function uniqueId() {
    const taken = new Set(state.entries.map((entry) => entry.id))
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = makeId()
      if (!taken.has(id)) return id
    }
    return `${makeId()}-${taken.size}`
  }

  load()

  return {
    file,

    /** Safe in every state: never includes entry content. */
    status() {
      return {
        locked: encrypted && !unlocked,
        encrypted,
        alg: encrypted ? ENVELOPE_ALG : null,
        total: encrypted && !unlocked ? 0 : state.entries.length,
        file,
      }
    },

    /** Run the document through decryption; keeps the key only in memory. */
    unlock(passphrase) {
      if (!encrypted) throw new Error('知识库尚未加密')
      if (unlocked) return this.status()
      const opened = openEnvelope(readEnvelope(), passphrase)
      key = opened.key
      salt = opened.salt
      state = normalizeState(opened.document)
      unlocked = true
      touch()
      return this.status()
    },

    /** Drop the key and the plaintext document. */
    lock() {
      if (encrypted) {
        if (key !== null) key.fill(0)
        key = null
        salt = null
        state = emptyState()
        unlocked = false
      }
      lastAccess = 0
      return this.status()
    },

    /** Encrypt a plaintext (or fresh) knowledge base. */
    async setupPassphrase(passphrase) {
      const secret = String(passphrase ?? '')
      if (secret.length < MIN_PASSPHRASE) throw new Error(`口令至少需要 ${MIN_PASSPHRASE} 个字符`)
      if (encrypted) throw new Error('知识库已经加密，请用「修改口令」')
      const nextSalt = randomBytes(SALT_BYTES)
      const nextKey = deriveKey(secret, nextSalt)
      salt = nextSalt
      key = nextKey
      encrypted = true
      try {
        await persist()
      } catch (error) {
        encrypted = false
        key.fill(0)
        key = null
        salt = null
        throw error
      }
      touch()
      return this.status()
    },

    async changePassphrase(current, next) {
      if (!encrypted) throw new Error('知识库尚未加密')
      const secret = String(next ?? '')
      if (secret.length < MIN_PASSPHRASE) throw new Error(`新口令至少需要 ${MIN_PASSPHRASE} 个字符`)
      // Verify against the file so a wrong "current" cannot rekey silently.
      const opened = openEnvelope(readEnvelope(), current)
      opened.key.fill(0)
      const nextSalt = randomBytes(SALT_BYTES)
      const nextKey = deriveKey(secret, nextSalt)
      if (key !== null) key.fill(0)
      salt = nextSalt
      key = nextKey
      unlocked = true
      state = normalizeState(opened.document)
      touch()
      await persist()
      return this.status()
    },

    /** Searchable (confirmed) entries; pending reflux is reported separately. */
    count() {
      if (encrypted && !unlocked) return 0
      let confirmed = 0
      for (const entry of state.entries) if (entry.state !== 'pending') confirmed += 1
      return confirmed
    },

    /** Confirmed vs pending reflux counts (safe while locked: both 0). */
    counts() {
      if (encrypted && !unlocked) return { confirmed: 0, pending: 0 }
      let pending = 0
      for (const entry of state.entries) if (entry.state === 'pending') pending += 1
      return { confirmed: state.entries.length - pending, pending }
    },

    getSettings() {
      if (encrypted && !unlocked) {
        return { recall: true, reflux: { lastRunAt: null, lastSummary: '' } }
      }
      return clone(state.settings)
    },

    async updateSettings(patch) {
      requireUnlocked()
      if (patch !== null && typeof patch === 'object') {
        if (typeof patch.recall === 'boolean') state.settings.recall = patch.recall
        if (patch.reflux !== null && typeof patch.reflux === 'object') {
          const reflux = patch.reflux
          if (typeof reflux.lastRunAt === 'string') state.settings.reflux.lastRunAt = reflux.lastRunAt
          if (typeof reflux.lastSummary === 'string') state.settings.reflux.lastSummary = reflux.lastSummary
        }
      }
      await persist()
      touch()
      return this.getSettings()
    },

    /** Newest first. */
    list() {
      if (encrypted && !unlocked) return []
      touch()
      return clone(
        [...state.entries].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
      )
    },

    get(id) {
      if (encrypted && !unlocked) return undefined
      touch()
      const entry = state.entries.find((candidate) => candidate.id === id)
      return entry === undefined ? undefined : clone(entry)
    },

    async add(input) {
      requireUnlocked()
      const title = requireText(input?.title, '标题', MAX_TITLE)
      const content = requireText(input?.content, '内容', MAX_CONTENT)
      const now = iso()
      const explicit = input?.sensitive === true || input?.sensitive === false ? input.sensitive : undefined
      const entry = {
        id: uniqueId(),
        title,
        content,
        tags: normalizeTags(input?.tags),
        source: text(input?.source).slice(0, MAX_SOURCE),
        sensitive: explicit === undefined ? looksSensitive(title, content) : explicit,
        state: input?.state === 'pending' ? 'pending' : 'confirmed',
        origin: input?.origin === 'reflux' ? 'reflux' : 'manual',
        sessionId: text(input?.sessionId).slice(0, 120) === '' ? undefined : text(input?.sessionId).slice(0, 120),
        reason: input?.reason === 'confirm' || input?.reason === 'change' ? input.reason : undefined,
        createdAt: now,
        updatedAt: now,
      }
      state.entries.push(entry)
      await persist()
      touch()
      return clone(entry)
    },

    /** Add a knowledge note awaiting review (the daily digest writes here). */
    async addPending(input) {
      requireUnlocked()
      const title = requireText(input?.title, '标题', MAX_TITLE)
      const content = requireText(input?.content, '内容', MAX_CONTENT)
      return this.add({
        title,
        content,
        tags: Array.isArray(input?.tags) ? input.tags : ['回流', '知识点'],
        source: typeof input?.source === 'string' && input.source !== '' ? input.source : 'daily-digest',
        // The digest already drops credential lines, so a mere mention must not
        // hide the whole note from the prompt index.
        sensitive: looksSensitiveValue(title, content),
        state: 'pending',
        origin: 'reflux',
        sessionId: input?.sessionId,
      })
    },

    async update(id, patch) {
      requireUnlocked()
      const entry = state.entries.find((candidate) => candidate.id === id)
      if (entry === undefined) throw new Error(`没有找到 id 为 ${id} 的知识库条目`)
      if (patch?.title !== undefined) entry.title = requireText(patch.title, '标题', MAX_TITLE)
      if (patch?.content !== undefined) entry.content = requireText(patch.content, '内容', MAX_CONTENT)
      if (patch?.tags !== undefined) entry.tags = normalizeTags(patch.tags)
      if (patch?.source !== undefined) entry.source = text(patch.source).slice(0, MAX_SOURCE)
      if (patch?.sensitive === true || patch?.sensitive === false) entry.sensitive = patch.sensitive
      entry.updatedAt = iso()
      await persist()
      touch()
      return clone(entry)
    },

    async remove(id) {
      requireUnlocked()
      const index = state.entries.findIndex((candidate) => candidate.id === id)
      if (index < 0) return false
      state.entries.splice(index, 1)
      await persist()
      touch()
      return true
    },

    /**
     * Ranked retrieval. An empty query lists every entry (newest first).
     * `tags` must all match (substring, case-insensitive). Sensitive entries
     * are returned only with `includeSensitive`; pending reflux entries only
     * with `includePending` (agent tools never pass it).
     */
    search(query, options = {}) {
      if (encrypted && !unlocked) return []
      const limit = clampInt(options.limit, 1, 200, 5)
      const wanted = normalizeTags(options.tags).map((tag) => tag.toLowerCase())
      const phrase = asString(query).trim()
      const tokens = phrase === '' ? [] : tokensOf(phrase)
      const includeSensitive = options.includeSensitive !== false
      const includePending = options.includePending === true
      const scored = []
      for (const entry of state.entries) {
        if (entry.state === 'pending' && !includePending) continue
        if (entry.sensitive && !includeSensitive) continue
        if (wanted.length > 0) {
          const tags = entry.tags.map((tag) => tag.toLowerCase())
          if (!wanted.every((tag) => tags.some((candidate) => candidate.includes(tag)))) continue
        }
        const score = phrase === '' ? 0 : scoreEntry(entry, tokens, phrase.toLowerCase())
        if (phrase !== '' && score <= 0) continue
        scored.push({ entry, score })
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.entry.updatedAt < b.entry.updatedAt ? 1 : a.entry.updatedAt > b.entry.updatedAt ? -1 : 0
      })
      return scored.slice(0, limit).map(({ entry, score }) => ({ entry: clone(entry), score }))
    },

    /**
     * A model-facing digest of the best *non-sensitive* matches.
     * `hits === 0` (or an empty query) yields `text: null`.
     */
    searchDigest(query, options = {}) {
      if (encrypted && !unlocked) return { hits: 0, text: null }
      const phrase = asString(query).trim()
      if (phrase === '') return { hits: 0, text: null }
      const hits = this.search(phrase, {
        limit: clampInt(options.limit, 1, 10, 4),
        includeSensitive: false,
      })
      if (hits.length === 0) return { hits: 0, text: null }
      const blocks = []
      hits.forEach((hit, index) => {
        const entry = hit.entry
        const metas = [`id: ${entry.id}`]
        if (entry.tags.length > 0) metas.push(`标签: ${entry.tags.join('、')}`)
        if (entry.source !== '') metas.push(`来源: ${entry.source}`)
        metas.push(`相关度 ${hit.score}`)
        metas.push(`更新 ${entry.updatedAt.slice(0, 10)}`)
        blocks.push(`[${index + 1}] ${entry.title}（${metas.join('；')}）`)
        blocks.push(truncate(entry.content, clampInt(options.perEntryChars, 200, 20_000, 1200)))
        blocks.push('')
      })
      return {
        hits: hits.length,
        text: truncate(blocks.join('\n').trim(), clampInt(options.maxChars, 400, 40_000, 5000)),
      }
    },

    /**
     * Compact title/summary index for the system-prompt section. Confirmed
     * entries only, and sensitive entries contribute their title only.
     */
    indexText(maxChars = 4000) {
      if (encrypted && !unlocked) return ''
      const confirmed = state.entries.filter((entry) => entry.state !== 'pending')
      if (confirmed.length === 0) return ''
      const sorted = [...confirmed].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      const lines = []
      let used = 0
      let skipped = 0
      for (const entry of sorted) {
        const summary = entry.sensitive
          ? '（敏感内容已隐藏，仅可显式 kb_search）'
          : entry.content.replace(/\s+/gu, ' ').slice(0, 90)
        const tags = entry.tags.length > 0 ? ` ｜ 标签: ${entry.tags.join(',')}` : ''
        const line = `- ${entry.id} ｜ ${entry.title}${tags} ｜ ${summary}`
        if (used + line.length + 1 > maxChars) {
          skipped += 1
          continue
        }
        lines.push(line)
        used += line.length + 1
      }
      if (skipped > 0) lines.push(`（另有 ${skipped} 条未列出，请用 kb_search 检索）`)
      return lines.join('\n')
    },

    /**
     * Promote pending reflux entries into the searchable set.
     *
     * @param {readonly string[] | undefined} ids specific entries, or every
     *   pending entry when omitted.
     * @returns the number promoted.
     */
    async confirm(ids) {
      requireUnlocked()
      const wanted = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
      let promoted = 0
      const now = iso()
      for (const entry of state.entries) {
        if (entry.state !== 'pending') continue
        if (wanted !== null && !wanted.has(entry.id)) continue
        entry.state = 'confirmed'
        entry.updatedAt = now
        promoted += 1
      }
      if (promoted > 0) {
        await persist()
        touch()
      }
      return promoted
    },

    /** Pending reflux entries, newest first. */
    pending() {
      if (encrypted && !unlocked) return []
      touch()
      return clone(
        state.entries
          .filter((entry) => entry.state === 'pending')
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
      )
    },

    /**
     * Store one knowledge note. A note never overwrites an earlier pending
     * one: a review that has not happened yet must not lose what it was going
     * to review. An identical note is a no-op, so a quiet turn adds nothing.
     *
     * @returns {{ entry: object, created: boolean, changed: boolean }}
     */
    async upsertReflux(sessionId, input) {
      requireUnlocked()
      const title = requireText(input?.title, '标题', MAX_TITLE)
      const content = requireText(input?.content, '内容', MAX_CONTENT)
      const existing = state.entries.find(
        (entry) => entry.origin === 'reflux' && entry.sessionId === sessionId && entry.content === content,
      )
      if (existing !== undefined) {
        touch()
        return { entry: clone(existing), created: false, changed: false }
      }
      const entry = await this.add({
        title,
        content,
        tags: ['回流', '知识点'],
        source: `session:${sessionId}`,
        state: 'pending',
        origin: 'reflux',
        sessionId,
        reason: 'knowledge',
      })
      return { entry, created: true, changed: true }
    },

    /** Serializable summary for diagnostics/tests. Never includes content. */
    stats() {
      const counts = this.counts()
      return {
        total: counts.confirmed + counts.pending,
        ...counts,
        file,
        settings: this.getSettings(),
        loadError,
        encrypted,
        locked: encrypted && !unlocked,
      }
    },
  }
}
