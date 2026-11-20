/**
 * dsh-knowledge-base — Host half.
 *
 * Responsibilities:
 *   1. Agent tools: kb_search / kb_add (edit and delete stay in the UI).
 *   2. A system-prompt section that states the precedence rule and carries a
 *      compact index of every entry, so the model knows what the knowledge
 *      base holds before it decides to go online.
 *   3. "Knowledge base first":
 *      - `tools/pre-execute` retrieves the knowledge base for the exact web
 *        query before the web call runs, so the material is in hand first;
 *      - `tools/post-execute` prepends that digest to every web_search result,
 *        so the model reads the authoritative material beside the web answer
 *        and resolves conflicts in the knowledge base's favour.
 *      The web search itself is never paused or blocked.
 *   4. Local JSON routes for the Settings → 知识库 page.
 *
 * The knowledge base file lives outside the workspace, under the profile data
 * directory; `store.js` owns it.
 */

import { mkdir, writeFile } from 'node:fs/promises'

import { createBuffer } from './buffer.js'
import { collectMaterial } from './reflux.js'
import { createStore, defaultDataFile } from './store.js'

export const name = 'knowledge-base'
export const inject = ['tools', 'systemPrompt', 'webServer']

const PREFIX = '/api/knowledge-base'
const PLUGIN_HEADER = 'x-dsh-plugin'
const PLUGIN_TOKENS = new Set(['knowledge-base', 'dsh-knowledge-base'])
const MAX_BODY_BYTES = 4 * 1024 * 1024

/** The single online-retrieval tool the gate and enrichment watch. */
const WEB_SEARCH = 'web_search'

/**
 * The search text of a web call. The shipped `web_search` takes
 * `queries: string[]`; older/other providers may use `query` or `q`.
 */
function queryOf(exec) {
  const args = exec?.arguments
  if (args === null || typeof args !== 'object') return ''
  if (typeof args.query === 'string' && args.query.trim() !== '') return args.query.trim()
  if (Array.isArray(args.queries)) {
    const parts = args.queries
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    if (parts.length > 0) return parts.join(' ')
  }
  if (typeof args.q === 'string' && args.q.trim() !== '') return args.q.trim()
  return ''
}

/* ------------------------------------------------------------------------- */
/* Content blocks                                                            */
/* ------------------------------------------------------------------------- */

function textBlock(value) {
  return { type: 'text', text: String(value) }
}

function previewOf(entry) {
  const flat = entry.content.replace(/\s+/gu, ' ')
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat
}

function listEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    tags: entry.tags,
    source: entry.source,
    sensitive: entry.sensitive === true,
    state: entry.state === 'pending' ? 'pending' : 'confirmed',
    origin: entry.origin === 'reflux' ? 'reflux' : 'manual',
    sessionId: entry.sessionId,
    reason: entry.reason,
    compare: entry.compare ?? undefined,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    size: entry.content.length,
    preview: entry.sensitive ? '（敏感内容，点击编辑查看）' : previewOf(entry),
  }
}

/* ------------------------------------------------------------------------- */
/* Rendered tool results                                                     */
/* ------------------------------------------------------------------------- */

function renderSearchResult(value) {
  const query = typeof value?.query === 'string' ? value.query : ''
  const count = Number(value?.count ?? 0)
  const total = Number(value?.total ?? 0)
  const results = Array.isArray(value?.results) ? value.results : []
  if (count === 0) {
    const label = query === '' ? '（空检索词）' : `「${query}」`
    return `知识库检索${label}：没有命中（知识库共 ${total} 条）。可以继续联网检索，但请在回复中说明该部分内容不来自知识库。`
  }
  const lines = [
    query === ''
      ? `知识库共 ${total} 条，列出 ${count} 条：`
      : `知识库检索「${query}」：命中 ${count} 条（知识库共 ${total} 条）`,
  ]
  results.forEach((result, index) => {
    const metas = [`id: ${result.id}`]
    if (Array.isArray(result.tags) && result.tags.length > 0) metas.push(`标签: ${result.tags.join('、')}`)
    if (typeof result.score === 'number') metas.push(`相关度 ${result.score}`)
    if (typeof result.updatedAt === 'string') metas.push(`更新 ${result.updatedAt.slice(0, 10)}`)
    if (result.sensitive === true) metas.push('敏感条目')
    lines.push('')
    lines.push(`[${index + 1}] ${result.title}（${metas.join('；')}）`)
    lines.push(String(result.content ?? ''))
    if (result.truncated === true) lines.push('（条目较长，以上内容已截断）')
    if (result.sensitive === true) {
      lines.push('（本条为敏感内容：仅在用户明确需要时引用，不要在回复里完整展示，也不要发往任何外部服务。）')
    }
  })
  return lines.join('\n')
}

function renderEntrySaved(value, verb) {
  const entry = value?.entry ?? {}
  const tags = Array.isArray(entry.tags) && entry.tags.length > 0 ? `；标签: ${entry.tags.join('、')}` : ''
  return `${verb}知识库条目「${entry.title}」（id: ${entry.id}${tags}）。当前知识库共 ${value?.total ?? 0} 条。`
}

/* ------------------------------------------------------------------------- */
/* Schemas                                                                   */
/* ------------------------------------------------------------------------- */

const ENTRY_PROPERTIES = {
  id: { type: 'string', description: '条目 id（kb- 开头）。' },
  title: { type: 'string', description: '条目标题。' },
  content: { type: 'string', description: '条目正文。' },
  tags: { type: 'array', items: { type: 'string' }, description: '标签列表。' },
  source: { type: 'string', description: '来源（URL、文件名或出处）。' },
  createdAt: { type: 'string', description: '创建时间（ISO 8601）。' },
  updatedAt: { type: 'string', description: '更新时间（ISO 8601）。' },
  state: { type: 'string', description: '状态：confirmed 或 pending。' },
  origin: { type: 'string', description: '来源：manual 或 reflux。' },
  sessionId: { type: 'string', description: '回流条目的来源会话 id。' },
  reason: { type: 'string', description: '回流原因标记。' },
  sensitive: { type: 'boolean', description: '是否敏感：不进提示词摘要，将来也不进向量索引。' },
  compare: {
    type: 'object',
    additionalProperties: true,
    description: '与已有条目的重复度对比（仅在部分重复时出现）。',
  },
}

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: ENTRY_PROPERTIES,
  required: ['id', 'title', 'content', 'tags', 'source', 'createdAt', 'updatedAt'],
}

const SAVED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entry: ENTRY_SCHEMA,
    total: { type: 'number', description: '写入后知识库条目总数。' },
  },
  required: ['entry', 'total'],
}

/* ------------------------------------------------------------------------- */
/* Prompt text                                                               */
/* ------------------------------------------------------------------------- */

function promptSectionText(store) {
  const status = store.status()
  if (status.locked) {
    return [
      '## 知识库（Knowledge Base）',
      '知识库已加密并锁定：在你获得解锁之前，它没有任何可用内容。',
      '不要尝试检索或写入知识库，也不要猜测、复述或编造它的内容。',
      '用户需要知识库时，提示他到「设置 → 知识库」输入口令解锁。',
    ].join('\n')
  }
  const total = store.count()
  const lines = [
    '## 知识库（Knowledge Base）',
    '当前环境挂载了一个由用户手动维护的本地知识库。知识库条目是用户认定的权威资料，优先级高于联网检索结果与你的先验记忆。',
    '',
    '必须遵守：',
    '1. 每次 web_search 之前，环境都会先检索知识库，并把命中内容附在检索结果的前面。你也可以随时用 kb_search 主动检索更多。',
    '2. 联网检索照常进行，不必因为知识库有内容而放弃联网。但当知识库内容与网络结果冲突时，以知识库为准，并在回复中说明冲突点与来源差异。',
    '3. 标注来源：知识库内容写「[知识库] 条目标题」（必要时附 id），网络内容附链接。不要把两者混为一谈。',
    '4. 知识库没有相关条目时，明确说明「知识库中未找到」，直接采用联网结果，并注明该部分来自网络。',
    '5. 用户要求长期保存资料时可调用 kb_add 写入；修改或删除条目请在「设置 → 知识库」里由用户本人完成，你没有这两个工具。',
    '6. 标记为「敏感」的条目（密码、密钥、令牌等）只在用户明确要求时引用，绝不在回复中完整展示，也不要发送到任何外部服务；系统提示词与自动联网检索都不会带上它们。',
    '7. 定时任务协议：用户消息以「定时任务」开头时，把该消息剩余内容整体建成定时任务（消息里给了时间就用该时间，否则取最近的空闲时段；高峰为周一至周五 9:00-12:00、14:00-18:00，其余时段含周末与节假日全天为空闲），建成后回报任务 id、标题与下次执行时间；不要把它当成话题标签，也不要只执行内容而不排期。',
    '',
  ]
  if (total === 0) {
    lines.push('当前知识库为空：没有可优先采用的资料，联网检索不受限制。')
    return lines.join('\n')
  }
  lines.push(`知识库索引（共 ${total} 条，仅标题与摘要；正文请用 kb_search 获取）：`)
  lines.push(store.indexText(3900))
  return lines.join('\n')
}

/* ------------------------------------------------------------------------- */
/* HTTP helpers                                                              */
/* ------------------------------------------------------------------------- */

function httpError(status, code, message) {
  return Object.assign(new Error(message), { statusCode: status, code })
}

/** Every route that reads or writes content requires an unlocked vault. */
function ensureUnlocked(store) {
  if (store.status().locked) throw httpError(423, 'LOCKED', '知识库已锁定，请先输入口令解锁。')
}

function sendJson(response, status, body) {
  if (response.writableEnded) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_BODY_BYTES) throw httpError(413, 'BODY_TOO_LARGE', '请求体过大')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw httpError(400, 'INVALID_BODY', '请求体不是合法 JSON')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw httpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象')
  }
  return data
}

/** One local JSON route: method, plugin-header, origin, then the handler. */
function route(ctx, handler) {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED', '只接受 POST')
      if (!PLUGIN_TOKENS.has(request.headers[PLUGIN_HEADER])) {
        throw httpError(403, 'FORBIDDEN', `缺少 ${PLUGIN_HEADER} 头`)
      }
      const origin = request.headers.origin
      if (typeof origin === 'string' && origin !== '') {
        let expected
        let actual
        try {
          expected = new URL(ctx.webServer.getOrigin()).host
        } catch {
          expected = undefined
        }
        try {
          actual = new URL(origin).host
        } catch {
          actual = undefined
        }
        if (expected !== undefined && actual !== expected) {
          throw httpError(403, 'FORBIDDEN', '请求来源不是本机 Harness 页面')
        }
      }
      await handler(request, response)
    } catch (error) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 400
      const code = typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED'
      sendJson(response, status, { error: { code, message: error?.message ?? String(error) } })
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Tools                                                                     */
/* ------------------------------------------------------------------------- */

function searchTool(store) {
  return {
    name: 'kb_search',
    description:
      '检索本地知识库（用户手动录入的权威资料）。在调用 web_search / web_fetch 之前必须先调用本工具；命中的内容优先于网络结果。query 传空字符串可列出全部条目。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索词；传空字符串列出全部条目。' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回条数，默认 5。' },
        tags: { type: 'array', items: { type: 'string' }, description: '按标签过滤（需全部命中）。' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          total: { type: 'number' },
          count: { type: 'number' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                score: { type: 'number' },
                updatedAt: { type: 'string' },
                sensitive: { type: 'boolean' },
                content: { type: 'string' },
                truncated: { type: 'boolean' },
              },
              required: ['id', 'title', 'tags', 'score', 'updatedAt', 'sensitive', 'content', 'truncated'],
            },
          },
        },
        required: ['query', 'total', 'count', 'results'],
      },
      render: (_args, value) => [textBlock(renderSearchResult(value))],
    },
    async execute(args) {
      if (store.status().locked) {
        throw new Error('知识库已锁定：请在「设置 → 知识库」输入口令解锁后再检索。')
      }
      const query = typeof args?.query === 'string' ? args.query : ''
      const hits = store.search(query, { limit: args?.limit, tags: args?.tags })
      // A non-empty query with no hit is the evidence that lexical recall has a
      // gap; it feeds the migration decision shown in Settings.
      if (hits.length === 0 && query.trim() !== '') await store.noteMiss(query)
      const value = {
        query,
        total: store.count(),
        count: hits.length,
        results: hits.map((hit) => ({
          id: hit.entry.id,
          title: hit.entry.title,
          tags: hit.entry.tags,
          score: hit.score,
          updatedAt: hit.entry.updatedAt,
          sensitive: hit.entry.sensitive === true,
          content:
            hit.entry.content.length > 3000 ? `${hit.entry.content.slice(0, 3000)}\n…（已截断）` : hit.entry.content,
          truncated: hit.entry.content.length > 3000,
        })),
      }
      return value
    },
  }
}

function addTool(store) {
  return {
    name: 'kb_add',
    description:
      '向本地知识库新增一条资料。仅在用户明确要求保存、或用户给出应长期保留的事实时使用；写入后该内容会成为后续回答的优先依据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '条目标题，一句话概括。' },
        content: { type: 'string', description: '条目正文（纯文本或 Markdown）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签。' },
        source: { type: 'string', description: '可选来源（URL、文件名、出处）。' },
      },
      required: ['title', 'content'],
    },
    output: {
      schema: SAVED_SCHEMA,
      render: (_args, value) => [textBlock(renderEntrySaved(value, '已写入'))],
    },
    async execute(args) {
      const entry = await store.add(args)
      return { entry, total: store.count() }
    },
  }
}

// Editing and deleting entries stay in the Settings page. The agent only gets
// kb_search and kb_add, so untrusted web content cannot talk it into removing
// or rewriting the user's authoritative material.

/* ------------------------------------------------------------------------- */
/* Plugin                                                                    */
/* ------------------------------------------------------------------------- */

export function apply(ctx) {
  const store = createStore({ dataFile: defaultDataFile() })
  const bufferFile = `${store.file.replace(/[^\\/]+$/u, '')}reflux-buffer.json`
  const buffer = createBuffer(bufferFile)

  /**
   * The scheduled digest is a separate conversation with a static prompt, so it
   * cannot know this process's port. Publish the live base URL next to the data
   * file and let the task read it instead of hard-coding a port that changes on
   * every restart.
   */
  const endpointFile = `${store.file.replace(/[^\\/]+$/u, '')}endpoint.json`
  function publishEndpoint() {
    let baseUrl = ''
    try {
      baseUrl = String(ctx.webServer.getOrigin())
    } catch {
      baseUrl = ''
    }
    if (baseUrl === '') return
    const payload = JSON.stringify({ baseUrl, api: `${baseUrl}${PREFIX}`, updatedAt: new Date().toISOString() }, null, 2)
    void mkdir(endpointFile.replace(/[^\\/]+$/u, ''), { recursive: true })
      .then(() => writeFile(endpointFile, payload, 'utf8'))
      .catch(() => {})
  }
  publishEndpoint()

  /**
   * Knowledge base digests captured before a web call runs, keyed by call id.
   * The key is removed when its post-execute runs; the size cap only guards
   * against a call that never reaches the waterfall (for example another
   * plugin denied it).
   */
  const pending = new Map()

  function remember(callId, digest) {
    if (callId === undefined || callId === null) return
    if (pending.size >= 64) {
      const oldest = pending.keys().next()
      if (!oldest.done) pending.delete(oldest.value)
    }
    pending.set(callId, digest)
  }

  function take(callId) {
    if (callId === undefined || callId === null) return undefined
    const digest = pending.get(callId)
    if (digest !== undefined) pending.delete(callId)
    return digest
  }

  /* ----- system prompt ----- */

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'knowledge-base',
        order: 60,
        text: () => promptSectionText(store),
      }),
    'knowledge-base: prompt section',
  )

  /* ----- agent tools ----- */

  for (const definition of [searchTool(store), addTool(store)]) {
    ctx.effect(() => ctx.tools.register(definition), `knowledge-base: ${definition.name} tool`)
  }

  /* ----- reflux: one recap per session, refreshed when a turn ends ----- */

  let refluxChain = Promise.resolve()

  /**
   * Last reflux attempt, surfaced on `/status` and `/list` so a silent skip is
   * visible instead of looking like a broken feature.
   */
  const refluxTrace = { lastAttemptAt: null, lastResult: 'idle', lastEntryId: null, lastError: '' }

  function noteReflux(result, entryId = null, detail = '') {
    refluxTrace.lastAttemptAt = new Date().toISOString()
    refluxTrace.lastResult = result
    refluxTrace.lastEntryId = entryId
    refluxTrace.lastError = String(detail ?? '').slice(0, 300)
  }

  /**
   * The session's own events, oldest first.
   *
   * A live `Session` has NO `events` array: it exposes `ownEvents()` (and
   * `snapshotEvents()`). Reading `session.events` therefore always yielded an
   * empty list and the reflux silently never ran.
   */
  function sessionEvents(agent) {
    const sessions = ctx.get('sessions')
    if (sessions === undefined || typeof sessions.get !== 'function') return []
    const session = sessions.get(agent.id)
    if (session === undefined || session === null) return []
    if (typeof session.ownEvents === 'function') {
      const own = session.ownEvents()
      if (Array.isArray(own)) return own
    }
    if (typeof session.snapshotEvents === 'function') {
      const all = session.snapshotEvents()
      if (Array.isArray(all)) return all
    }
    return []
  }

  /**
   * Record one finished turn into the daily buffer.
   *
   * Nothing is distilled here: the scheduled daily task reads the buffer and
   * writes the knowledge notes, so a turn end costs no model call at all.
   */
  function bufferTurn(sessionId, turn) {
    if (store.status().locked) {
      noteReflux('locked')
      return Promise.resolve()
    }
    const events = sessionEvents({ id: sessionId })
    if (events.length === 0) {
      noteReflux('no-session-events')
      return Promise.resolve()
    }
    const material = collectMaterial(events)
    if (material.length === 0) {
      noteReflux('empty-recap')
      return Promise.resolve()
    }
    refluxChain = refluxChain
      .then(async () => {
        const added = await buffer.append(
          material.map((item) => ({ session: String(sessionId), role: item.role, text: item.text, time: Date.now() })),
        )
        noteReflux(added > 0 ? 'buffered' : 'unchanged')
        if (added > 0) {
          await store.updateSettings({
            reflux: {
              lastRunAt: new Date().toISOString(),
              lastSummary: `缓存 ${added} 段对话（第 ${turn} 轮），等待每日整理`,
            },
          })
        }
      })
      .catch((error) => {
        noteReflux('error', null, String(error?.message ?? error))
        console.warn('[knowledge-base] 对话缓存失败：', error)
      })
    return refluxChain
  }

  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        // Post-commit feed: when `turn/end` arrives the closing assistant
        // message is already in the log.
        if (event?.type !== 'turn/end') return
        // A subagent's session is machinery, not a conversation to digest.
        if (session?.header?.origin === 'subagent') return
        const id = session?.id
        if (id === undefined || id === null) return
        try {
          return bufferTurn(id, Number(event.data?.turn ?? 0))
        } catch (error) {
          console.warn('[knowledge-base] 对话缓存失败：', error)
        }
      }),
    'knowledge-base: buffer on turn end',
  )

  /* ----- knowledge base first: retrieve before the web call runs ----- */

  ctx.effect(
    () =>
      ctx.on('tools/pre-execute', async (exec, next) => {
        if (exec?.name !== WEB_SEARCH) return next()
        if (!store.getSettings().recall) return next()
        const query = queryOf(exec)
        if (query !== '') {
          const digest = store.searchDigest(query, { limit: 3, perEntryChars: 1200, maxChars: 4600 })
          if (digest.hits > 0 && digest.text !== null) {
            remember(exec.callId, { query, hits: digest.hits, text: digest.text })
          } else if (!store.status().locked) {
            await store.noteMiss(query)
          }
        }
        return next()
      }),
    'knowledge-base: web-search pre-retrieval',
  )

  /* ----- knowledge base first: attach the digest to the web result ----- */

  ctx.effect(
    () =>
      ctx.on('tools/post-execute', async (exec, result, next) => {
        const captured = take(exec?.callId)
        const decision = await next()
        if (captured === undefined) return decision
        if (decision?.kind !== 'accept' || decision.value !== undefined) return decision
        if (result?.isError === true) return decision
        const base = Array.isArray(decision.content) ? decision.content : result.content
        return {
          kind: 'accept',
          content: [
            textBlock(
              `【知识库优先】知识库中与「${captured.query}」相关的资料（${captured.hits} 条）如下。联网结果随后给出；两者冲突时以知识库为准，并在回复中标注「[知识库] 标题」。\n\n${captured.text}`,
            ),
            ...(Array.isArray(base) ? base : []),
          ],
        }
      }),
    'knowledge-base: web-search enrichment',
  )

  /* ----- drop the key when this plugin unloads ------------------------- */

  ctx.effect(() => () => store.lock(), 'knowledge-base: lock on unload')

  /* ----- local routes for the Settings page ----- */

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/status`,
        handler: route(ctx, async (request, response) => {
          await readBody(request)
          sendJson(response, 200, {
            status: store.status(),
            reflux: { ...refluxTrace },
            index: store.indexStats(),
            search: store.searchStats(),
            sensitive: store.sensitiveCount(),
          })
        }),
      }),
    'knowledge-base: status route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/unlock`,
        handler: route(ctx, async (request, response) => {
          const body = await readBody(request)
          try {
            const status = store.unlock(typeof body.passphrase === 'string' ? body.passphrase : '')
            sendJson(response, 200, { status })
          } catch (error) {
            sendJson(response, 400, {
              error: { code: 'UNLOCK_FAILED', message: error?.message ?? '解锁失败' },
            })
          }
        }),
      }),
    'knowledge-base: unlock route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/lock`,
        handler: route(ctx, async (request, response) => {
          await readBody(request)
          sendJson(response, 200, { status: store.lock() })
        }),
      }),
    'knowledge-base: lock route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/passphrase`,
        handler: route(ctx, async (request, response) => {
          const body = await readBody(request)
          const next = typeof body.next === 'string' ? body.next : ''
          const current = typeof body.current === 'string' ? body.current : ''
          try {
            if (store.status().encrypted) await store.changePassphrase(current, next)
            else await store.setupPassphrase(next)
            sendJson(response, 200, { status: store.status() })
          } catch (error) {
            sendJson(response, 400, {
              error: { code: 'PASSPHRASE_FAILED', message: error?.message ?? '设置口令失败' },
            })
          }
        }),
      }),
    'knowledge-base: passphrase route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/list`,
        handler: route(ctx, async (request, response) => {
          const body = await readBody(request)
          const status = store.status()
          const counts = store.counts()
          const settings = store.getSettings()
          const reflux = {
            lastRunAt: settings.reflux.lastRunAt,
            lastSummary: settings.reflux.lastSummary,
            ...refluxTrace,
          }
          const index = store.indexStats()
          const search = store.searchStats()
          const sensitive = store.sensitiveCount()
          if (status.locked) {
            sendJson(response, 200, {
              status,
              total: 0,
              entries: [],
              pending: [],
              counts: { confirmed: 0, pending: 0 },
              settings,
              reflux,
              index,
              search,
              sensitive,
              file: store.file,
            })
            return
          }
          const query = typeof body.q === 'string' ? body.q.trim() : ''
          const limit = typeof body.limit === 'number' ? body.limit : 200
          const entries =
            query === ''
              ? store.list().map(listEntry)
              : store.search(query, { limit }).map((hit) => ({ ...listEntry(hit.entry), score: hit.score }))
          sendJson(response, 200, {
            status,
            total: counts.confirmed,
            entries,
            pending: store.pending().map((entry) => ({ ...listEntry(entry), content: entry.content })),
            counts,
            settings,
            reflux,
            index,
            search,
            sensitive,
            file: store.file,
          })
        }),
      }),
    'knowledge-base: list route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/get`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          const body = await readBody(request)
          const entry = store.get(typeof body.id === 'string' ? body.id : '')
          if (entry === undefined) throw httpError(404, 'NOT_FOUND', '没有找到该知识库条目，可能已被删除。')
          sendJson(response, 200, { entry })
        }),
      }),
    'knowledge-base: get route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/save`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          const body = await readBody(request)
          const entry =
            typeof body.id === 'string' && body.id !== ''
              ? await store.update(body.id, body)
              : await store.add(body)
          sendJson(response, 200, { entry, total: store.count() })
        }),
      }),
    'knowledge-base: save route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/delete`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          const body = await readBody(request)
          const id = typeof body.id === 'string' ? body.id : ''
          const deleted = await store.remove(id)
          sendJson(response, 200, { id, deleted, total: store.count() })
        }),
      }),
    'knowledge-base: delete route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/settings`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          const body = await readBody(request)
          const settings = await store.updateSettings(body)
          sendJson(response, 200, { settings, total: store.count() })
        }),
      }),
    'knowledge-base: settings route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/confirm`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          const body = await readBody(request)
          const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : undefined
          const confirmed = await store.confirm(ids)
          sendJson(response, 200, { confirmed, counts: store.counts(), total: store.count() })
        }),
      }),
    'knowledge-base: confirm route',
  )

  /* ----- daily digest: the scheduled task reads these ----- */

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/buffer`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          await readBody(request)
          const snapshot = await buffer.read()
          sendJson(response, 200, {
            chars: snapshot.chars,
            sessions: snapshot.sessions,
            updatedAt: snapshot.updatedAt,
            entries: snapshot.entries.map((entry) => ({
              time: new Date(entry.time).toISOString(),
              role: entry.role,
              session: entry.session,
              text: entry.text,
            })),
            file: snapshot.file,
          })
        }),
      }),
    'knowledge-base: buffer route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/buffer/clear`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          await readBody(request)
          const removed = await buffer.clear()
          await store.updateSettings({
            reflux: { lastRunAt: new Date().toISOString(), lastSummary: `每日整理完成，清空 ${removed} 段缓存对话` },
          })
          sendJson(response, 200, { removed })
        }),
      }),
    'knowledge-base: buffer clear route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/pending`,
        handler: route(ctx, async (request, response) => {
          ensureUnlocked(store)
          const body = await readBody(request)
          const result = await store.addPending({
            title: body.title,
            content: body.content,
            tags: body.tags,
            source: body.source,
            sessionId: body.sessionId,
          })
          if (result.discarded === true) {
            sendJson(response, 200, {
              discarded: true,
              reason: 'duplicate',
              compare: result.compare,
              counts: store.counts(),
              total: store.count(),
            })
            return
          }
          sendJson(response, 200, {
            discarded: false,
            entry: result.entry,
            compare:
              result.compare.matches.length > 0
                ? {
                    withId: result.compare.matches[0].id,
                    withTitle: result.compare.matches[0].title,
                    same: result.compare.same.length,
                    added: result.compare.added.length,
                  }
                : undefined,
            counts: store.counts(),
            total: store.count(),
          })
        }),
      }),
    'knowledge-base: pending route',
  )
}
