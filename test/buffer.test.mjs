import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBuffer } from '../buffer.js'

function assert(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`)
  console.log(`ok - ${label}`)
}

const dir = await mkdtemp(join(tmpdir(), 'kb-buffer-'))
const file = join(dir, 'reflux-buffer.json')
const buffer = createBuffer(file)

const empty = await buffer.read()
assert(empty.entries.length === 0 && empty.chars === 0, 'a fresh buffer is empty')

const added = await buffer.append([
  { session: 's1', role: 'user', text: '以后发货都按 24 小时承诺', time: Date.now() },
  { session: 's1', role: 'assistant', text: '已记录。', time: Date.now() },
])
assert(added === 2, 'both lines are buffered')

const repeat = await buffer.append([{ session: 's1', role: 'user', text: '以后发货都按 24 小时承诺', time: Date.now() }])
assert(repeat === 0, 'the same line is never buffered twice')

await buffer.append([{ session: 's2', role: 'user', text: '导出报表统一用 UTF-8', time: Date.now() }])
const snapshot = await buffer.read()
assert(snapshot.entries.length === 3, 'lines from another session are kept')
assert(snapshot.sessions.join(',') === 's1,s2', 'sessions are reported')
assert(snapshot.chars > 0, 'characters are counted')

const onDisk = JSON.parse(await readFile(file, 'utf8'))
assert(Array.isArray(onDisk.entries) && onDisk.entries.length === 3, 'the buffer is persisted')

const removed = await buffer.clear()
assert(removed === 3, 'clear reports how much was dropped')
const cleared = await buffer.read()
assert(cleared.entries.length === 0, 'the buffer is empty after clear')

// A stale entry (older than the 72h window) never reaches the digest.
await buffer.append([{ session: 's1', role: 'user', text: '三天前的旧对话内容', time: Date.now() - 80 * 60 * 60 * 1000 }])
const pruned = await buffer.read()
assert(pruned.entries.length === 0, 'entries older than the retention window are dropped')

// A corrupt file starts empty instead of throwing.
await writeFile(file, '{oops', 'utf8')
const corrupt = createBuffer(file)
const recovered = await corrupt.read()
assert(recovered.entries.length === 0, 'a corrupt buffer starts empty')

await rm(dir, { recursive: true, force: true })
console.log('\nall buffer tests passed')
