import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, looksSensitive, tokensOf } from '../store.js'

const dir = await mkdtemp(join(tmpdir(), 'kb-test-'))
const file = join(dir, 'kb.json')

function assert(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`)
  console.log(`ok - ${label}`)
}

const store = createStore({ dataFile: file })
assert(store.file === file, 'store exposes data file')
assert(store.count() === 0, 'starts empty')
assert(store.status().encrypted === false && store.status().locked === false, 'fresh store is plaintext and open')
assert(store.getSettings().reflux.lastRunAt === null, 'reflux starts unrun')

const a = await store.add({
  title: '退款政策',
  content: '客户在签收后 7 天内可以申请无理由退款。超过 7 天需人工审核。',
  tags: '售后, 退款',
  source: 'https://example.com/policy',
})
const b = await store.add({
  title: 'Pricing for Enterprise',
  content: 'Enterprise plan costs 99 USD per seat per month, billed annually.',
  tags: ['pricing', 'sales'],
})
await store.add({ title: '发货时效', content: '现货商品在 24 小时内发出，预售商品以详情页为准。', tags: ['物流'] })
const secret = await store.add({
  title: '后台账号',
  content: '账号 admin，密码 Passw0rd!',
  tags: ['账号'],
})
assert(store.count() === 4, 'four confirmed entries')
assert(store.counts().pending === 0, 'no pending entries yet')
assert(a.id.startsWith('kb-'), 'id generated')
assert(a.tags.length === 2, 'tags parsed from string')
assert(b.tags.length === 2, 'tags parsed from array')
assert(looksSensitive('后台账号', '账号 admin，密码 Passw0rd!') === true, 'secret detection works')
assert(secret.sensitive === true, 'credential entry is flagged sensitive')
assert(a.sensitive === false, 'ordinary entry is not sensitive')

assert(store.search('退款')[0].entry.title === '退款政策', 'chinese search finds refund policy')
assert(store.search('enterprise pricing')[0].entry.title.includes('Enterprise'), 'english search finds pricing')
assert(store.search('完全不存在的内容xyz').length === 0, 'no hit for absent phrase')
assert(store.search('', { limit: 2 }).length === 2, 'empty query lists entries')
assert(store.search('', { tags: ['物流'] }).length === 1, 'tag filter works')

assert(store.search('密码').length === 1, 'explicit search may return a sensitive entry')
assert(store.search('密码', { includeSensitive: false }).length === 0, 'sensitive entries can be excluded')
assert(store.searchDigest('密码').hits === 0, 'digest never includes sensitive entries')

/* --- reflux: pending entries stay out of retrieval ---------------------- */
const pending = await store.add({
  title: '确认：退款时效说明',
  content: '会话确认记录\n\n用户确认了以下内容：\n签收后 7 天内可无理由退款。',
  tags: ['回流', '确认'],
  state: 'pending',
  origin: 'reflux',
  sessionId: 's1',
  reason: 'confirm',
})
assert(store.counts().pending === 1 && store.count() === 4, 'pending entry is counted separately')
assert(store.pending().length === 1 && store.pending()[0].id === pending.id, 'pending list holds the entry')
assert(store.search('确认记录').length === 0, 'pending entries are not searchable')
assert(store.search('确认记录', { includePending: true }).length === 1, 'pending entries can be listed explicitly')
assert(!store.indexText().includes('退款时效说明'), 'pending entries stay out of the prompt index')
assert(!store.searchDigest('确认记录').text, 'pending entries never reach the digest')

assert((await store.confirm([pending.id])) === 1, 'confirm promotes the entry')
assert(store.count() === 5 && store.counts().pending === 0, 'confirmed count grows')
assert(store.search('确认记录').length === 1, 'confirmed reflux becomes searchable')
assert((await store.confirm()) === 0, 'confirm with nothing pending is a no-op')

/* --- reflux: a pending note is never overwritten ------------------------ */
const recapBody = '知识点整理（2026-11-06）\n\n- 签收后 7 天内可退款。'
const first = await store.upsertReflux('s2', { title: '退款规则', content: recapBody })
assert(first.created === true && first.changed === true, 'first note creates a pending entry')
const again = await store.upsertReflux('s2', { title: '退款规则', content: recapBody })
assert(again.created === false && again.changed === false, 'an identical note is a no-op')
const second = await store.upsertReflux('s2', { title: '发货时效', content: '知识点整理（2026-11-06）\n\n- 现货 24 小时内发出。' })
assert(second.created === true && second.changed === true, 'a different note is a new pending entry, not an overwrite')
assert(store.counts().pending === 2, 'both notes stay pending until a human reviews them')
assert(store.pending().some((entry) => entry.title === '退款规则'), 'the earlier note is still there')
assert(store.pending().some((entry) => entry.title === '发货时效'), 'the later note is there too')

/* --- digest notes: a mere credential mention is not a secret ------------- */
const plainNote = await store.addPending({
  title: '接口返回码',
  content: '知识点整理（2026-11-12）\n\n- 接口返回 423 表示知识库已锁定，不能用口令绕过。',
})
assert(plainNote.state === 'pending' && plainNote.origin === 'reflux', 'addPending stores an unreviewed note')
assert(plainNote.sensitive === false, 'a note that only mentions credentials stays searchable')

const secretNote = await store.addPending({
  title: '账号',
  content: '知识点整理（2026-11-12）\n\n- 后台密码是 Passw0rd!',
})
assert(secretNote.sensitive === true, 'a note that carries a credential value is hidden')

/* --- settings ----------------------------------------------------------- */
await store.updateSettings({ recall: false })
await store.updateSettings({ reflux: { lastRunAt: '2026-11-06T10:00:00.000Z', lastSummary: 'ok' } })
const settings = store.getSettings()
assert(settings.recall === false, 'recall persists')
assert(settings.reflux.lastRunAt === '2026-11-06T10:00:00.000Z' && settings.reflux.lastSummary === 'ok', 'reflux summary persists')

assert((await store.remove(b.id)) === true, 'remove returns true')
assert((await store.remove('missing')) === false, 'remove unknown returns false')
assert(store.count() === 4, 'count after remove')

const plaintext = await readFile(file, 'utf8')
assert(plaintext.includes('退款政策'), 'plaintext file before encryption')

/* --- encryption at rest ------------------------------------------------- */
await store.setupPassphrase('correct horse battery staple')
assert(store.status().encrypted === true && store.status().locked === false, 'passphrase encrypts and keeps it open')
const sealed = await readFile(file, 'utf8')
const envelope = JSON.parse(sealed)
assert(envelope.encrypted === true && envelope.alg === 'dsh-kb-aes-256-gcm', 'file holds an AES-GCM envelope')
assert(!sealed.includes('退款政策') && !sealed.includes('Passw0rd'), 'no plaintext survives in the file')

await store.add({ title: '加密后条目', content: '加密写入也需要口令密钥。', tags: ['测试'] })
assert(store.count() === 5, 'writes after encryption')

/* --- lock / unlock ------------------------------------------------------ */
store.lock()
assert(store.status().locked === true, 'lock sets the locked state')
assert(store.count() === 0 && store.list().length === 0, 'locked store exposes no entries')
assert(store.pending().length === 0, 'locked store exposes no pending entries')
assert(store.search('退款').length === 0, 'locked search returns nothing')
assert(store.indexText().length === 0, 'locked index is empty')
assert(store.get(secret.id) === undefined, 'locked get returns nothing')
let addRejected = false
try {
  await store.add({ title: 'x', content: 'y' })
} catch {
  addRejected = true
}
assert(addRejected === true, 'locked writes are rejected')

let wrongRejected = false
try {
  store.unlock('wrong passphrase')
} catch (error) {
  wrongRejected = String(error.message).includes('口令')
}
assert(wrongRejected === true, 'wrong passphrase is rejected')

store.unlock('correct horse battery staple')
assert(store.count() === 5 && store.get(a.id).content.includes('7 天'), 'unlock restores the document')

/* --- change passphrase -------------------------------------------------- */
await store.changePassphrase('correct horse battery staple', 'another long passphrase')
store.lock()
let oldRejected = false
try {
  store.unlock('correct horse battery staple')
} catch {
  oldRejected = true
}
assert(oldRejected === true, 'old passphrase stops working')
store.unlock('another long passphrase')
assert(store.count() === 5, 'new passphrase opens the vault')

/* --- reopen: an encrypted file starts locked ---------------------------- */
const reopened = createStore({ dataFile: file })
assert(reopened.status().locked === true && reopened.status().encrypted === true, 'reopen starts locked')
reopened.unlock('another long passphrase')
assert(reopened.count() === 5, 'reopened document decrypts')

/* --- corrupt file ------------------------------------------------------- */
const brokenFile = join(dir, 'broken.json')
await writeFile(brokenFile, '{ not json', 'utf8')
const recovered = createStore({ dataFile: brokenFile })
assert(recovered.count() === 0, 'corrupt file starts empty')
assert(recovered.stats().loadError !== null, 'corrupt load reported')

assert(tokensOf('退款 7天 ABC').includes('退款'), 'tokenizer keeps bigram')
assert(tokensOf('ABC').includes('abc'), 'tokenizer lowercases latin')

await rm(dir, { recursive: true, force: true })

console.log('\nall store tests passed')
