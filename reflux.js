/**
 * dsh-knowledge-base — conversation material for the daily digest.
 *
 * Nothing is distilled when a turn ends: the Host only strips the machine
 * noise (runtime snapshots, notices, secrets) out of the session, and the
 * scheduled daily task turns that material into knowledge notes.
 */

const SENSITIVE_RE =
  /(密码|口令|密钥|令牌|验证码|恢复码|secret|passw(?:or)?d|api[_-]?key|access[_-]?key|token)/iu

/**
 * The harness injects machine context as `user/message` too: the runtime
 * snapshot, the skill catalog, the per-turn time sample, and subagent
 * notifications. Those describe the machine, not what a human asked, so the
 * whole line is dropped.
 */
const DROP_MARKERS = [
  '<system-reminder>',
  '<available_skills>',
  'Current runtime context',
  'Time sampled while preparing turn',
  'Tokens prefixed with @',
  '知识库（Knowledge Base）',
  'The runtime context names the DeepSeek Harness implementation checkout',
  // Harness notices delivered as user text.
  'The approval policy changed',
  'sent a message:',
  'sent you a message just before finishing',
  'finished and will do no further work',
]

/**
 * A subagent's parent instruction appends its wrapper AFTER the real question,
 * so this one is cut rather than dropped: the prefix is the actual ask.
 */
const TRUNCATE_MARKERS = ['Your parent agent id is']

/** Bare instructions that carry no knowledge of their own. */
const CHATTER_RE =
  /^(测试|测试一下|继续|继续测试|完整测试|再试|好|好的|行|可以|收到|谢谢|嗯|ok|okay|已解锁|解锁了|停止|开始|看看|试试|对|是的|没问题|确认|明白|了解|好滴)[。.!！?？~～\s]*$/iu

/** All text blocks of a message, joined. */
export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

export function textOfMessage(message) {
  return textOfContent(message?.content)
}

function collapse(value) {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Bound one stored line; the marker is explicit, never a bare ellipsis. */
function trim(value, max) {
  const body = collapse(value)
  return body.length > max ? `${body.slice(0, max)}（后略）` : body
}

/** Drop machine blocks, or keep the part before a trailing subagent wrapper. */
function stripHarnessBlocks(text) {
  let result = text
  for (const marker of TRUNCATE_MARKERS) {
    const index = result.indexOf(marker)
    if (index >= 0) result = result.slice(0, index)
  }
  for (const marker of DROP_MARKERS) {
    if (result.includes(marker)) return ''
  }
  return result.trim()
}

/** Markdown → plain text, so the material carries no fences or tables. */
function plainText(value) {
  return collapse(
    String(value ?? '')
      .replace(/```[\s\S]*?```/gu, ' ')
      .replace(/`([^`]*)`/gu, '$1')
      .replace(/\*\*([^*]+)\*\*/gu, '$1')
      .replace(/^#{1,6}\s*/gmu, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\|/gu, ' '),
  )
}

/**
 * The conversation as the digest should see it: recent user asks and the last
 * few answers, stripped of machine blocks, secrets and pure chatter.
 *
 * @param {readonly any[]} events session events, oldest first
 * @param {{ maxUserLines?: number, maxAnswers?: number, answerChars?: number }} [options]
 * @returns {Array<{ role: 'user' | 'assistant', text: string }>}
 */
export function collectMaterial(events, options = {}) {
  if (!Array.isArray(events)) return []
  const maxUserLines = Math.max(1, Number(options.maxUserLines ?? 10))
  const maxAnswers = Math.max(0, Number(options.maxAnswers ?? 3))
  const answerChars = Math.max(200, Number(options.answerChars ?? 2000))

  const asks = []
  const answers = []

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'user/message') {
      const text = collapse(stripHarnessBlocks(textOfMessage(event.data)))
      if (text === '' || CHATTER_RE.test(text)) continue
      if (SENSITIVE_RE.test(text)) continue
      if (asks[asks.length - 1] !== text) asks.push(text)
      continue
    }
    if (event.type === 'assistant/message') {
      const text = plainText(textOfMessage(event.data?.message))
      if (text === '' || SENSITIVE_RE.test(text)) continue
      if (answers[answers.length - 1] !== text) answers.push(text)
    }
  }

  const material = []
  for (const text of asks.slice(-maxUserLines)) material.push({ role: 'user', text: trim(text, 600) })
  if (maxAnswers > 0) {
    for (const text of answers.slice(-maxAnswers)) material.push({ role: 'assistant', text: trim(text, answerChars) })
  }
  return material
}
