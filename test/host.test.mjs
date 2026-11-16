import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'kb-host-'))
process.env.DSH_PROFILE_DIR = dir
await mkdir(join(dir, 'knowledge-base'), { recursive: true })
await writeFile(
  join(dir, 'knowledge-base', 'kb.json'),
  JSON.stringify({
    version: 2,
    settings: { recall: true },
    entries: [
      {
        id: 'kb-test-1',
        title: '退款政策',
        content: '客户签收后 7 天内可无理由退款；超过 7 天需人工审核。',
        tags: ['售后', '退款'],
        source: 'https://example.com/policy',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'kb-test-2',
        title: '后台账号',
        content: '账号 admin，密码 Passw0rd!',
        tags: ['账号'],
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ],
  }),
  'utf8',
)

const { apply } = await import('../index.js')

function assert(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`)
  console.log(`ok - ${label}`)
}

const now = Date.now()
const sessionEvents = [
  {
    type: 'user/message',
    seq: 0,
    time: now - 60_000,
    data: { role: 'user', content: [{ type: 'text', text: '退款多久内可以无理由？' }] },
  },
  {
    type: 'assistant/message',
    seq: 1,
    time: now - 50_000,
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '签收后 7 天内可无理由退款，超过 7 天需要人工审核。' }],
      },
    },
  },
  {
    type: 'user/message',
    seq: 2,
    time: now - 40_000,
    data: { role: 'user', content: [{ type: 'text', text: '确认' }] },
  },
  {
    type: 'user/message',
    seq: 3,
    time: now - 30_000,
    data: { role: 'user', content: [{ type: 'text', text: '以后发货都按 24 小时承诺' }] },
  },
]

// Only bare instructions: nothing worth buffering.
const chatterEvents = [
  {
    type: 'user/message',
    seq: 0,
    time: now - 3_000,
    data: { role: 'user', content: [{ type: 'text', text: '测试' }] },
  },
  {
    type: 'user/message',
    seq: 1,
    time: now - 2_000,
    data: { role: 'user', content: [{ type: 'text', text: '继续' }] },
  },
]

const listeners = new Map()
const tools = new Map()
const sections = []
const routes = new Map()
const effects = []

const ctx = {
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
    return dispose
  },
  on(event, fn) {
    if (listeners.has(event)) throw new Error(`duplicate listener for ${event}`)
    listeners.set(event, fn)
    return () => listeners.delete(event)
  },
  get(name) {
    if (name === 'sessions') {
      return {
        get: (id) => {
          // A live Session exposes ownEvents(); it has NO `events` array.
          if (id === 's1') return { id: 's1', ownEvents: () => sessionEvents }
          if (id === 's5') return { id: 's5' }
          if (id === 's6') return { id: 's6', ownEvents: () => chatterEvents }
          if (id === 's4') return { id: 's4' }
          return undefined
        },
      }
    }
    return undefined
  },
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
  systemPrompt: {
    section(section) {
      sections.push(section)
      return () => {}
    },
  },
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => {}
    },
    getOrigin() {
      return 'http://127.0.0.1:1'
    },
  },
}

apply(ctx)

assert(effects.length > 0, 'effects registered')
assert([...tools.keys()].sort().join(',') === 'kb_add,kb_search', 'two agent tools registered')
assert(sections.length === 1 && sections[0].name === 'knowledge-base', 'prompt section registered')
assert(routes.size === 13, 'thirteen routes registered')
assert(listeners.has('tools/pre-execute'), 'pre-execute listener registered')
assert(listeners.has('tools/post-execute'), 'post-execute listener registered')
assert(listeners.has('session/event'), 'turn-end buffer listener registered')

const prompt = sections[0].text()
assert(prompt.includes('退款政策'), 'prompt index lists the confirmed entry')
assert(prompt.includes('敏感内容已隐藏'), 'prompt index masks the sensitive entry')
assert(!prompt.includes('Passw0rd'), 'prompt carries no password')

/* --- tools --------------------------------------------------------------- */
const search = await tools.get('kb_search').execute({ query: '退款' }, { agent: { id: 's1' } })
assert(search.count === 1 && search.results[0].id === 'kb-test-1', 'kb_search returns the entry')

/* --- web search: never paused, digest attached -------------------------- */
const pre = listeners.get('tools/pre-execute')
const post = listeners.get('tools/post-execute')
const signal = () => new AbortController().signal
const webContent = [{ type: 'text', text: 'web result' }]

const allow = { kind: 'allow' }
const preDecision = await pre(
  { name: 'web_search', arguments: { queries: ['退款 政策'] }, agent: { id: 's2' }, callId: 'c1', signal: signal() },
  async () => allow,
)
assert(preDecision === allow, 'the web search is allowed, never paused')

const enriched = await post(
  { name: 'web_search', arguments: { queries: ['退款 政策'] }, agent: { id: 's2' }, callId: 'c1', signal: signal() },
  { isError: false, value: { sources: [] }, content: webContent },
  async () => ({ kind: 'accept' }),
)
assert(enriched.content[0].text.includes('知识库优先') && enriched.content[0].text.includes('退款政策'), 'digest prepended')
assert(!enriched.content[0].text.includes('Passw0rd'), 'the digest never carries a secret')

/* --- routes ------------------------------------------------------------- */
async function callRoute(path, body, expectStatus) {
  const route = routes.get(`/api/knowledge-base${path}`)
  let status = 0
  let payload = ''
  const request = {
    method: 'POST',
    headers: { 'x-dsh-plugin': 'knowledge-base' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}))
    },
  }
  const response = {
    writableEnded: false,
    writeHead(code) {
      status = code
    },
    end(chunk) {
      payload = chunk
      response.writableEnded = true
    },
  }
  await route.handler(request, response)
  if (expectStatus !== undefined) assert(status === expectStatus, `HTTP ${expectStatus} for ${path}`)
  return { status, body: JSON.parse(payload) }
}

const list = await callRoute('/list', {}, 200)
assert(list.body.status.encrypted === false && list.body.status.locked === false, 'list reports a plaintext, open vault')
assert(list.body.total === 2 && list.body.counts.pending === 0, 'list starts with two confirmed entries')
assert(list.body.reflux.lastRunAt === null, 'reflux starts unrun')

const settingsOff = await callRoute('/settings', { recall: false }, 200)
assert(settingsOff.body.settings.recall === false, 'settings route stores recall = false')
await callRoute('/settings', { recall: true }, 200)

const saved = await callRoute('/save', { title: '发货时效', content: '现货 24 小时内发出。', tags: '物流' }, 200)
assert(saved.body.entry.id.startsWith('kb-') && saved.body.total === 3, 'save route creates')
const got = await callRoute('/get', { id: saved.body.entry.id }, 200)
assert(got.body.entry.content.includes('24 小时'), 'get route reads full content')
await callRoute('/delete', { id: saved.body.entry.id }, 200)

/* --- turn end: material lands in the daily buffer, nothing is distilled --- */
const sessionEvent = listeners.get('session/event')
function endTurn(id, turn, header) {
  return sessionEvent(
    { id, header: { id, ...(header ?? {}) } },
    { type: 'turn/end', seq: 0, time: now, data: { turn, reason: { kind: 'completed' } } },
  )
}
await endTurn('s1', 2)

const buffered = await callRoute('/buffer', {}, 200)
assert(buffered.body.entries.length >= 3, 'turn end buffers the turn material')
assert(buffered.body.entries.some((entry) => entry.text.includes('24 小时承诺')), 'a real instruction is buffered')
assert(!buffered.body.entries.some((entry) => entry.text.includes('Passw0rd')), 'credentials are never buffered')
assert(buffered.body.chars > 0 && buffered.body.sessions.includes('s1'), 'the buffer reports its size and sessions')

const afterBuffer = await callRoute('/list', {}, 200)
assert(afterBuffer.body.counts.pending === 0, 'a turn end writes no knowledge by itself')
assert(afterBuffer.body.reflux.lastResult === 'buffered', 'the attempt is reported as buffered')

/* --- skips (dedupe, subagent, chatter, no session) ----------------------- */
await endTurn('s1', 3)
const repeated = await callRoute('/list', {}, 200)
assert(repeated.body.reflux.lastResult === 'unchanged', 'the same turn material is not buffered twice')

await endTurn('s5', 1, { origin: 'subagent' })
const subagentTurn = await callRoute('/list', {}, 200)
assert(subagentTurn.body.reflux.lastResult === 'unchanged', 'a subagent session is not buffered')

await endTurn('s6', 1)
const chatterTurn = await callRoute('/list', {}, 200)
assert(chatterTurn.body.reflux.lastResult === 'empty-recap', 'a session of bare instructions buffers nothing')

await endTurn('s4', 1)
const noEvents = await callRoute('/list', {}, 200)
assert(noEvents.body.reflux.lastResult === 'no-session-events', 'a session without events reports why it skipped')

/* --- the daily task writes pending notes --------------------------------- */
const noteContent = '知识点整理（2026-11-11）\n\n- 签收后 7 天内可无理由退款，超过 7 天需要人工审核。'
const pendingNote = await callRoute('/pending', { title: '退款与发货规则', content: noteContent }, 200)
assert(pendingNote.body.entry.state === 'pending', 'the daily task stores a pending note')
assert(pendingNote.body.entry.title === '退款与发货规则', 'the title is the knowledge topic')
assert(!pendingNote.body.entry.title.startsWith('对话：'), 'the title is not a chat line')
assert(pendingNote.body.entry.tags.includes('知识点'), 'the note is tagged as knowledge')
assert(pendingNote.body.counts.pending === 1 && pendingNote.body.total === 2, 'a pending note is not searchable yet')
assert(!sections[0].text().includes('知识点整理'), 'the pending note stays out of the prompt')

const pendingSearch = await tools.get('kb_search').execute({ query: '知识点整理' }, { agent: { id: 's1' } })
assert(pendingSearch.count === 0, 'the pending note is not searchable')

const confirmed = await callRoute('/confirm', {}, 200)
assert(confirmed.body.confirmed === 1 && confirmed.body.counts.pending === 0, 'confirm promotes the note')
const afterConfirm = await callRoute('/list', {}, 200)
assert(afterConfirm.body.total === 3 && afterConfirm.body.counts.confirmed === 3, 'confirmed note joins the searchable set')
assert(sections[0].text().includes('退款与发货规则'), 'prompt index gains the confirmed note')

const refluxSearch = await tools.get('kb_search').execute({ query: '知识点整理' }, { agent: { id: 's1' } })
assert(refluxSearch.count >= 1, 'the confirmed note is searchable')

/* --- the buffer is cleared after the daily run --------------------------- */
const cleared = await callRoute('/buffer/clear', {}, 200)
assert(cleared.body.removed > 0, 'clearing reports how much was dropped')
const emptyBuffer = await callRoute('/buffer', {}, 200)
assert(emptyBuffer.body.entries.length === 0 && emptyBuffer.body.chars === 0, 'the buffer is empty again')

const removed = await callRoute('/delete', { id: pendingNote.body.entry.id }, 200)
assert(removed.body.total === 2, 'the test note is deleted again')

/* --- encrypt, lock, unlock ---------------------------------------------- */
const setup = await callRoute('/passphrase', { next: 'test-passphrase-123' }, 200)
assert(setup.body.status.encrypted === true && setup.body.status.locked === false, 'passphrase encrypts the vault')

const locked = await callRoute('/lock', {}, 200)
assert(locked.body.status.locked === true, 'lock route locks the vault')

const lockedList = await callRoute('/list', {}, 200)
assert(lockedList.body.total === 0 && lockedList.body.entries.length === 0, 'locked list exposes no entries')
assert(lockedList.body.pending.length === 0, 'locked list exposes no pending entries')

const lockedGet = await callRoute('/get', { id: 'kb-test-1' }, 423)
assert(lockedGet.body.error.code === 'LOCKED', 'locked get is refused')

assert(sections[0].text().includes('已加密并锁定'), 'prompt switches to the locked notice')

let lockedSearchRejected = false
try {
  await tools.get('kb_search').execute({ query: '退款' }, { agent: { id: 's1' } })
} catch (error) {
  lockedSearchRejected = String(error.message).includes('锁定')
}
assert(lockedSearchRejected === true, 'locked kb_search explains the lock')

const badUnlock = await callRoute('/unlock', { passphrase: 'wrong passphrase' }, 400)
assert(badUnlock.body.error.code === 'UNLOCK_FAILED', 'wrong passphrase is refused')

const goodUnlock = await callRoute('/unlock', { passphrase: 'test-passphrase-123' }, 200)
assert(goodUnlock.body.status.locked === false, 'correct passphrase unlocks')
assert(sections[0].text().includes('退款政策'), 'prompt index returns after unlock')

await callRoute('/passphrase', { current: 'test-passphrase-123', next: 'second-passphrase-456' }, 200)

/* --- cleanup ------------------------------------------------------------ */
for (const effect of effects) {
  if (typeof effect.dispose === 'function') effect.dispose()
}
await rm(dir, { recursive: true, force: true })
console.log('\nall host tests passed')

