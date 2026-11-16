import { collectMaterial } from '../reflux.js'

function assert(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`)
  console.log(`ok - ${label}`)
}

function user(text, time = 1) {
  return { type: 'user/message', seq: time, time, data: { role: 'user', content: [{ type: 'text', text }] } }
}

function assistant(text, time = 2) {
  return {
    type: 'assistant/message',
    seq: time,
    time,
    data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

/* --- material: what the daily digest may see ------------------------------ */

const events = [
  user('退款多久内可以无理由？', 1),
  assistant('签收后 7 天内可无理由退款，超过 7 天需要人工审核。', 2),
  user('确认', 3),
  user('以后发货都按 24 小时承诺', 4),
  assistant('已记录：现货 24 小时内发出。', 5),
]

const material = collectMaterial(events)
assert(material.length === 4, 'chatter and acknowledgements never reach the digest')
assert(material.some((item) => item.text === '以后发货都按 24 小时承诺'), 'a real instruction survives')
assert(!material.some((item) => item.text === '确认'), 'a bare acknowledgement is dropped')
assert(material.some((item) => item.role === 'assistant' && item.text.includes('7 天')), 'answers are included')

const harness = collectMaterial([
  user('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.', 1),
  user('Time sampled while preparing turn 1, step 1: 2026-11-11T17:47:19+08:00', 2),
  user('Agent a120d31a sent a message: 结果已写好。', 3),
  user('Background subagent a120d31a finished and will do no further work.', 4),
  user('请说明为什么 Windows 的文件名不区分大小写。 Your parent agent id is "session-1".', 5),
])
assert(harness.length === 1, 'machine blocks are not material')
assert(harness[0].text === '请说明为什么 Windows 的文件名不区分大小写。', 'a parent wrapper is cut, the ask is kept')

const secrets = collectMaterial([user('后台密码是 Passw0rd! 另外记住：导出报表用 UTF-8 编码。', 1)])
assert(secrets.length === 0, 'a credential line never leaves the machine')

const long = '甲'.repeat(900)
const trimmed = collectMaterial([user(long, 1)])
assert(trimmed[0].text.length < long.length, 'an over-long line is bounded')
assert(!trimmed[0].text.includes('…'), 'bounding uses an explicit marker, not an ellipsis')

assert(collectMaterial(null).length === 0, 'a missing event list yields nothing')
assert(collectMaterial([]).length === 0, 'an empty session yields nothing')
