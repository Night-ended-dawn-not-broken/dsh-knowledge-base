/**
 * dsh-knowledge-base — Client half.
 *
 * One Settings page (Settings → 知识库) for manual entry: list, search, create,
 * edit, delete, plus the "consult the knowledge base before web search" switch.
 * All data operations go through the Host's local JSON routes, so the page and
 * the agent tools share one store and one code path.
 *
 * No Harness Client package is imported: controls, styles and copy are local,
 * and only the documented `slots` / `locale` services are used.
 */

window.__ModuleLoader__.load({
  id: '@night-ended-dawn-not-broken/dsh-knowledge-base',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'knowledgeBase'
    const PREFIX = '/api/knowledge-base'
    const HEADER = 'x-dsh-plugin'
    /** Must match the Host row's accepted guard token. */
    const TOKEN = 'knowledge-base'

    let t = (key) => key

    /* --------------------------------------------------------------------- */
    /* Copy                                                                  */
    /* --------------------------------------------------------------------- */

    const zh = {
      'nav.label': '知识库',
      'page.title': '知识库',
      'page.subtitle': '共 {n} 条 · 联网检索时自动带上这里的内容',
      'page.add': '新增资料',
      'page.hint':
        '知识库内容优先于联网结果：每次联网检索都会先查知识库并把命中内容附在结果前；两者冲突时以知识库为准。',
      'page.search': '搜索标题、标签或正文…',
      'page.refresh': '刷新',
      'page.count': '共 {n} 条',
      'page.loading': '载入中…',
      'page.empty.title': '还没有资料',
      'page.empty.hint': '点击「新增资料」录入第一条内容：产品资料、内部规范、常用回答、术语表都可以。录入后模型会优先采用。',
      'page.noresult.title': '没有匹配的资料',
      'page.noresult.hint': '换个关键词，或清空搜索框查看全部。',
      'row.edit': '编辑',
      'row.delete': '删除',
      'row.confirm': '确认删除',
      'row.chars': '{n} 字',
      'row.source': '来源',
      'editor.new': '新增资料',
      'editor.edit': '编辑资料',
      'editor.field.title': '标题',
      'editor.field.titlePlaceholder': '一句话概括这条资料',
      'editor.field.tags': '标签',
      'editor.field.tagsPlaceholder': '用逗号分隔，例如：产品, 价格',
      'editor.field.source': '来源',
      'editor.field.sourcePlaceholder': '可填 URL、文件名或出处',
      'editor.field.content': '正文',
      'editor.field.contentPlaceholder': '粘贴或输入资料正文。支持纯文本与 Markdown；模型会按原文引用。',
      'editor.save': '保存',
      'editor.saving': '保存中…',
      'editor.cancel': '取消',
      'editor.required': '标题和正文都不能为空。',
      'editor.hint': 'Ctrl / ⌘ + Enter 保存',
      'settings.recall': '联网检索时自动带上知识库',
      'settings.recallHint': '每次联网检索前先查知识库，把命中内容附在结果前面；两者冲突时以知识库为准。联网检索本身照常进行。',
      'lock.title': '知识库已锁定',
      'lock.hint': '输入访问口令解锁。口令只用于本次运行，不会写入磁盘。',
      'lock.passphrase': '访问口令',
      'lock.unlock': '解锁',
      'lock.unlocking': '解锁中…',
      'lock.setupTitle': '设置访问口令',
      'lock.setupHint': '设置后知识库以 AES-256-GCM 加密保存，口令不落盘；忘记口令将无法恢复内容。',
      'lock.changeTitle': '修改访问口令',
      'lock.current': '当前口令',
      'lock.next': '新口令',
      'lock.confirm': '确认口令',
      'lock.submitSetup': '加密并锁定',
      'lock.submitChange': '保存新口令',
      'lock.cancel': '取消',
      'lock.short': '口令至少 8 个字符。',
      'lock.mismatch': '两次输入的口令不一致。',
      'lock.plain': '未加密',
      'lock.encrypted': '已加密',
      'lock.lockNow': '立即锁定',
      'lock.change': '修改口令',
      'lock.setup': '设置口令',
      'lock.plainWarning':
        '知识库尚未加密：内容仍以明文保存在磁盘上。请设置访问口令，之后所有内容都会加密存储。',
      'lock.autoHint': '重启 Harness 或手动锁定后需要重新校验。',
      'lock.bootHint': '打开 Harness 后需要校验一次访问口令；校验通过后本次运行不再自动锁定。',
      'lock.skip': '跳过（知识库保持锁定）',
      'row.sensitive': '敏感',
      'reflux.badge': '回流',
      'reflux.pendingTitle': '回流待确认',
      'reflux.pendingHint': '每日自动整理产出的知识点，暂不参与检索、不进提示词；确认后加入知识库，丢弃则删除。',
      'reflux.confirmAll': '全部确认',
      'reflux.confirm': '确认',
      'reflux.discard': '丢弃',
      'reflux.view': '查看全文',
      'reflux.collapse': '收起全文',
      'reflux.loading': '加载中…',
      'reflux.compareTitle': '与已有条目「{title}」内容重合',
      'reflux.compareCount': '重复 {same} 条 · 新增 {added} 条',
      'health.title': '检索健康度',
      'health.index': '系统提示词索引占用 {used}/{budget} 字，已溢出 {dropped} 条',
      'health.search': '检索未命中 {misses} 次 · 敏感条目 {sensitive} 条（不参与向量化）',
      'reflux.reasonConfirm': '确认项',
      'reflux.reasonChange': '更改项',
      'reflux.title': '对话回流',
      'reflux.hint': '每天 12:05 由自动化任务整理上一次整理以来的对话，提炼成知识点待确认；确认后才参与检索。',
      'reflux.never': '尚未回流',
      'reflux.lastRun': '上次回流：{time}',
      'reflux.attempt': '最近一次尝试：{time}',
      'reflux.result.idle': '等待首次触发',
      'reflux.result.buffered': '已缓存，等待每日整理',
      'reflux.result.created': '已生成待确认',
      'reflux.result.updated': '已更新待确认',
      'reflux.result.unchanged': '内容无变化',
      'reflux.result.already-recorded': '该知识点已确认过',
      'reflux.result.empty-recap': '暂无可用对话内容',
      'reflux.result.no-session-events': '未取到会话记录',
      'reflux.result.no-model': '模型不可用，已跳过',
      'reflux.result.no-knowledge': '本轮没有可沉淀的知识点',
      'reflux.result.locked': '知识库锁定，已跳过',
      'reflux.result.error': '回流失败',
      'editor.sensitive': '敏感内容',
      'editor.sensitiveHint': '不写入提示词摘要，也不随联网检索自动附带；仅在显式检索时返回。',
      'notice.saved': '已保存。',
      'notice.deleted': '已删除。',
      'error.load': '载入失败',
      'error.save': '保存失败',
      'error.delete': '删除失败',
      'error.settings': '设置保存失败',
      'error.retry': '重试',
      'footer.file': '数据文件：{path}',
    }

    const en = {
      'nav.label': 'Knowledge Base',
      'page.title': 'Knowledge Base',
      'page.subtitle': '{n} entries · attached to every web search',
      'page.add': 'Add material',
      'page.hint':
        'Knowledge base content outranks web results: every web search first checks the knowledge base and carries its matches; the knowledge base wins when the two conflict.',
      'page.search': 'Search title, tags or body…',
      'page.refresh': 'Refresh',
      'page.count': '{n} entries',
      'page.loading': 'Loading…',
      'page.empty.title': 'No material yet',
      'page.empty.hint':
        'Add your first entry: product facts, internal policies, canned answers, glossaries. Once saved, the model prefers it.',
      'page.noresult.title': 'No matching entries',
      'page.noresult.hint': 'Try another keyword, or clear the search box to see everything.',
      'row.edit': 'Edit',
      'row.delete': 'Delete',
      'row.confirm': 'Confirm delete',
      'row.chars': '{n} chars',
      'row.source': 'Source',
      'editor.new': 'New entry',
      'editor.edit': 'Edit entry',
      'editor.field.title': 'Title',
      'editor.field.titlePlaceholder': 'Summarize this entry in one line',
      'editor.field.tags': 'Tags',
      'editor.field.tagsPlaceholder': 'Comma separated, e.g. product, pricing',
      'editor.field.source': 'Source',
      'editor.field.sourcePlaceholder': 'URL, file name or origin',
      'editor.field.content': 'Content',
      'editor.field.contentPlaceholder': 'Paste or type the material. Plain text and Markdown are both fine.',
      'editor.save': 'Save',
      'editor.saving': 'Saving…',
      'editor.cancel': 'Cancel',
      'editor.required': 'Title and content are required.',
      'editor.hint': 'Ctrl / ⌘ + Enter to save',
      'settings.recall': 'Attach the knowledge base to web searches',
      'settings.recallHint':
        'Each web search first checks the knowledge base and puts its matches in front of the result; the knowledge base wins on conflict. The web search itself always runs.',
      'lock.title': 'Knowledge base is locked',
      'lock.hint': 'Enter the access passphrase. It is used for this run only and never written to disk.',
      'lock.passphrase': 'Access passphrase',
      'lock.unlock': 'Unlock',
      'lock.unlocking': 'Unlocking…',
      'lock.setupTitle': 'Set an access passphrase',
      'lock.setupHint':
        'The knowledge base is then stored with AES-256-GCM. The passphrase is never saved; losing it means the content cannot be recovered.',
      'lock.changeTitle': 'Change the access passphrase',
      'lock.current': 'Current passphrase',
      'lock.next': 'New passphrase',
      'lock.confirm': 'Confirm passphrase',
      'lock.submitSetup': 'Encrypt and lock',
      'lock.submitChange': 'Save new passphrase',
      'lock.cancel': 'Cancel',
      'lock.short': 'Use at least 8 characters.',
      'lock.mismatch': 'The two passphrases do not match.',
      'lock.plain': 'Not encrypted',
      'lock.encrypted': 'Encrypted',
      'lock.lockNow': 'Lock now',
      'lock.change': 'Change passphrase',
      'lock.setup': 'Set passphrase',
      'lock.plainWarning':
        'The knowledge base is not encrypted yet: its content is still plain text on disk. Set an access passphrase to encrypt it.',
      'lock.autoHint': 'Re-verified after a Harness restart or a manual lock.',
      'lock.bootHint':
        'The vault needs one passphrase check whenever Harness opens; after that it stays unlocked for this run.',
      'lock.skip': 'Skip (vault stays locked)',
      'row.sensitive': 'Sensitive',
      'reflux.badge': 'Reflux',
      'reflux.pendingTitle': 'Reflux awaiting review',
      'reflux.pendingHint':
        'Captured from conversations. Not searched and not in the prompt until confirmed; discard removes it.',
      'reflux.confirmAll': 'Confirm all',
      'reflux.confirm': 'Confirm',
      'reflux.discard': 'Discard',
      'reflux.view': 'Show full text',
      'reflux.collapse': 'Collapse',
      'reflux.loading': 'Loading…',
      'reflux.compareTitle': 'Overlaps the entry “{title}”',
      'reflux.compareCount': '{same} duplicate · {added} new',
      'health.title': 'Retrieval health',
      'health.index': 'Prompt index uses {used}/{budget} chars, {dropped} entries dropped',
      'health.search': '{misses} misses · {sensitive} sensitive entries (never vectorised)',
      'reflux.reasonConfirm': 'Confirmation',
      'reflux.reasonChange': 'Change',
      'reflux.title': 'Conversation reflux',
      'reflux.hint':
        'At the end of every turn, the session is condensed into one entry awaiting review; only confirmed entries are searchable.',
      'reflux.never': 'Never run',
      'reflux.lastRun': 'Last reflux: {time}',
      'reflux.attempt': 'Last attempt: {time}',
      'reflux.result.idle': 'waiting for the first trigger',
      'reflux.result.buffered': 'buffered for the daily digest',
      'reflux.result.created': 'one entry awaiting review',
      'reflux.result.updated': 'awaiting-review entry updated',
      'reflux.result.unchanged': 'nothing changed',
      'reflux.result.already-recorded': 'already confirmed earlier',
      'reflux.result.empty-recap': 'nothing to summarise',
      'reflux.result.no-session-events': 'no session log found',
      'reflux.result.no-model': 'no model available, skipped',
      'reflux.result.no-knowledge': 'no reusable knowledge this turn',
      'reflux.result.locked': 'vault locked, skipped',
      'reflux.result.error': 'reflux failed',
      'editor.sensitive': 'Sensitive content',
      'editor.sensitiveHint':
        'Excluded from the prompt summary and from automatic web-search attachment; returned only by an explicit search.',
      'notice.saved': 'Saved.',
      'notice.deleted': 'Deleted.',
      'error.load': 'Failed to load',
      'error.save': 'Failed to save',
      'error.delete': 'Failed to delete',
      'error.settings': 'Failed to save settings',
      'error.retry': 'Retry',
      'footer.file': 'Data file: {path}',
    }

    /* --------------------------------------------------------------------- */
    /* Host API                                                              */
    /* --------------------------------------------------------------------- */

    async function post(path, body) {
      const response = await fetch(`${PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [HEADER]: TOKEN },
        body: JSON.stringify(body ?? {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`)
      return data
    }

    /** Broadcast: the vault was just unlocked, hide any prompt. */
    const UNLOCK_EVENT = 'dsh-kb-unlocked'
    function announceUnlock() {
      try {
        window.dispatchEvent(new Event(UNLOCK_EVENT))
      } catch {
        /* a missing window is not fatal for a same-bundle helper */
      }
    }

    function normalizeSettings(value) {
      const source = value ?? {}
      const reflux = source.reflux ?? {}
      return {
        recall: source.recall !== false,
        reflux: {
          lastRunAt: typeof reflux.lastRunAt === 'string' ? reflux.lastRunAt : null,
          lastSummary: typeof reflux.lastSummary === 'string' ? reflux.lastSummary : '',
        },
      }
    }

    function fill(text, params) {
      let out = text
      for (const [key, value] of Object.entries(params ?? {})) {
        out = out.replaceAll(`{${key}}`, String(value))
      }
      return out
    }

    function formatDate(iso) {
      if (typeof iso !== 'string' || iso.length < 10) return ''
      return iso.slice(0, 10)
    }

    function formatTime(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value ?? '')
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /* --------------------------------------------------------------------- */
    /* Styles                                                                */
    /* --------------------------------------------------------------------- */

    const CSS = `
      .kb-page {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        gap: 10px;
        overflow-y: auto;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
        /* Room for the sticky search bar so it never paints over content. */
        scroll-padding-top: 48px;
      }
      .kb-page * { box-sizing: border-box; }
      /* The settings panel's section container is a plain block; while this page
         is mounted, make it a bounded column so the page owns the scrolling. */
      div:has(> [data-slot="settings.section"] > .kb-page) {
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .kb-head { display: flex; align-items: flex-start; gap: 12px; flex: none; }
      .kb-titles { min-width: 0; }
      .kb-title { font-size: 15px; font-weight: 600; line-height: 22px; }
      .kb-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
      .kb-actions { margin-left: auto; display: flex; gap: 8px; flex: none; }

      .kb-btn {
        height: 28px;
        padding: 0 10px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        font-family: inherit;
      }
      .kb-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); }
      .kb-btn:disabled { opacity: .5; cursor: default; }
      .kb-btn-primary {
        background: var(--dsw-alias-brand-primary);
        border-color: transparent;
        color: #fff;
        font-weight: 500;
      }
      .kb-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.06); }
      .kb-btn-danger {
        color: var(--dsw-alias-state-error-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
      }

      .kb-hint {
        flex: none;
        font-size: 12px;
        line-height: 18px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        padding: 7px 10px;
      }

      .kb-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        padding: 10px 12px;
      }
      .kb-settings { flex: none; display: flex; flex-direction: column; gap: 8px; }
      .kb-switch { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
      .kb-switch-input { position: absolute; width: 1px; height: 1px; opacity: 0; }
      .kb-switch-track {
        position: relative;
        flex: none;
        width: 32px;
        height: 18px;
        margin-top: 1px;
        border-radius: 9px;
        background: var(--dsw-alias-border-l2);
        transition: background .15s ease;
      }
      .kb-switch-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform .15s ease;
      }
      .kb-switch-input:checked + .kb-switch-track { background: var(--dsw-alias-brand-primary); }
      .kb-switch-input:checked + .kb-switch-track .kb-switch-thumb { transform: translateX(14px); }
      .kb-switch-input:focus-visible + .kb-switch-track { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .kb-switch-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .kb-switch-title { font-size: 13px; font-weight: 500; }
      .kb-switch-hint { font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary); }

      /* Stays at the top while the intro and settings scroll away. */
      .kb-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 6px 0;
        margin: -6px 0 0;
        background: var(--dsw-alias-bg-base);
      }
      .kb-search { flex: 1; min-width: 0; }
      .kb-input, .kb-textarea {
        width: 100%;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 7px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font-family: inherit;
        outline: none;
      }
      .kb-input { height: 30px; padding: 0 10px; font-size: 13px; }
      .kb-input:focus, .kb-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
      .kb-count { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); }

      .kb-body {
        flex: none;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .kb-row {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .kb-row:hover { border-color: var(--dsw-alias-border-l2); }
      .kb-row-main { flex: 1; min-width: 0; }
      .kb-row-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .kb-row-title { font-weight: 600; font-size: 13px; word-break: break-word; }
      .kb-tag {
        font-size: 11px;
        line-height: 16px;
        padding: 0 6px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
        color: var(--dsw-alias-brand-primary);
        white-space: nowrap;
      }
      .kb-row-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 3px; word-break: break-all; }
      .kb-row-preview {
        font-size: 12px;
        line-height: 18px;
        color: var(--dsw-alias-label-secondary);
        margin-top: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }
      .kb-row-actions { display: flex; gap: 6px; align-items: flex-start; flex: none; }
      .kb-row-full {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l1);
        font-size: 12px;
        line-height: 19px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 300px;
        overflow: auto;
      }
      /* Partial overlap with an existing entry: show what is new. */
      .kb-compare {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px dashed var(--dsw-alias-border-l2);
        font-size: 12px;
        line-height: 18px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .kb-compare-title { font-weight: 600; }
      .kb-compare-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .kb-compare-line { color: var(--dsw-alias-state-success-primary); word-break: break-word; }

      .kb-empty {
        flex: none;
        min-height: 220px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 36px 20px;
        text-align: center;
        border: 1px dashed var(--dsw-alias-border-l2);
        border-radius: 12px;
      }
      .kb-empty-title { font-weight: 600; }
      .kb-empty-hint { max-width: 440px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .kb-empty-actions { margin-top: 6px; }

      .kb-editor {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .kb-editor-head { font-weight: 600; font-size: 13px; }
      .kb-field { display: flex; flex-direction: column; gap: 4px; }
      .kb-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .kb-textarea {
        min-height: 220px;
        padding: 8px 10px;
        font-size: 13px;
        line-height: 20px;
        resize: vertical;
        background: var(--dsw-alias-bg-base);
      }
      .kb-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
      .kb-editor-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
      .kb-editor-hint { margin-right: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }

      .kb-error { flex: none; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
      .kb-notice { flex: none; font-size: 12px; color: var(--dsw-alias-state-success-primary); }
      .kb-footer {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .kb-mono {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      }

      .kb-badge {
        font-size: 11px;
        line-height: 16px;
        padding: 0 6px;
        border-radius: 4px;
        border: 1px solid var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .kb-warn {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        line-height: 18px;
        color: var(--dsw-alias-state-warn-primary);
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent);
        border-radius: 8px;
        padding: 8px 10px;
      }
      .kb-warn-text { flex: 1; min-width: 0; }
      .kb-lock { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
      .kb-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        /* The shell overlay layer is click-through; the prompt opts back in. */
        pointer-events: auto;
        background: color-mix(in srgb, #000 42%, transparent);
      }
      .kb-modal {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        max-width: 420px;
        padding: 16px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 16px 48px color-mix(in srgb, #000 30%, transparent);
      }
      .kb-lock-title { font-size: 15px; font-weight: 600; }
      .kb-lock-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .kb-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .kb-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
      .kb-status-dot[data-locked="1"] { background: var(--dsw-alias-state-warn-primary); }

      .kb-pending {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 32%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 5%, transparent);
        border-radius: 10px;
      }
      .kb-section-head { display: flex; align-items: center; gap: 8px; }
      .kb-section-title { flex: 1; font-size: 12px; font-weight: 600; }
      .kb-row-pending { background: var(--dsw-alias-bg-layer-1); }
      .kb-reflux { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
      .kb-reflux-meta { display: flex; align-items: center; gap: 10px; }
      .kb-reflux-when {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        line-height: 16px;
        color: var(--dsw-alias-label-secondary);
        word-break: break-word;
      }

      @media (prefers-reduced-motion: reduce) {
        .kb-switch-track, .kb-switch-thumb { transition: none; }
      }
    `

    /* --------------------------------------------------------------------- */
    /* Components                                                            */
    /* --------------------------------------------------------------------- */

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className:
            'kb-btn' + (props.primary === true ? ' kb-btn-primary' : '') + (props.danger === true ? ' kb-btn-danger' : ''),
          onClick: props.onClick,
          disabled: props.disabled === true,
          title: props.title,
        },
        props.children,
      )
    }

    function Field(props) {
      return h('label', { className: 'kb-field' }, [
        h('span', { key: 'label', className: 'kb-label' }, props.label),
        props.children,
      ])
    }

    function EntryRow(props) {
      const entry = props.entry
      const pending = props.mode === 'pending'
      const meta = []
      if (pending) {
        meta.push(entry.reason === 'confirm' ? t('reflux.reasonConfirm') : t('reflux.reasonChange'))
        if (entry.sessionId) meta.push(entry.sessionId)
      } else {
        meta.push(`#${entry.id}`)
        if (entry.updatedAt) meta.push(`${formatDate(entry.updatedAt)}`)
        meta.push(fill(t('row.chars'), { n: entry.size ?? 0 }))
        if (entry.source) meta.push(`${t('row.source')}: ${entry.source}`)
      }
      return h('div', { className: 'kb-row' + (pending ? ' kb-row-pending' : '') }, [
        h('div', { key: 'main', className: 'kb-row-main' }, [
          h('div', { key: 'head', className: 'kb-row-head' }, [
            h('span', { key: 'title', className: 'kb-row-title' }, entry.title),
            ...(entry.tags ?? []).map((tag) => h('span', { key: `tag-${tag}`, className: 'kb-tag' }, tag)),
            entry.origin === 'reflux' ? h('span', { key: 'reflux', className: 'kb-badge' }, t('reflux.badge')) : null,
            entry.sensitive === true
              ? h('span', { key: 'sensitive', className: 'kb-badge' }, t('row.sensitive'))
              : null,
          ]),
          h('div', { key: 'meta', className: 'kb-row-meta' }, meta.join(' · ')),
          pending && typeof entry.content === 'string'
            ? h('div', { key: 'full', className: 'kb-row-full' }, entry.content)
            : h('div', { key: 'preview', className: 'kb-row-preview' }, entry.preview ?? ''),
          pending && entry.compare !== undefined && entry.compare !== null
            ? h('div', { key: 'cmp', className: 'kb-compare' }, [
                h(
                  'div',
                  { key: 't', className: 'kb-compare-title' },
                  fill(t('reflux.compareTitle'), { title: String(entry.compare.withTitle ?? '') }),
                ),
                h(
                  'div',
                  { key: 'n', className: 'kb-compare-meta' },
                  fill(t('reflux.compareCount'), {
                    same: String(entry.compare.same ?? 0),
                    added: String(entry.compare.added ?? 0),
                  }),
                ),
                ...(Array.isArray(entry.compare.addedLines) ? entry.compare.addedLines : []).map((line, index) =>
                  h('div', { key: `add-${index}`, className: 'kb-compare-line' }, `+ ${line}`),
                ),
              ])
            : null,
        ]),
        h(
          'div',
          { key: 'actions', className: 'kb-row-actions' },
          pending
            ? [
                h(
                  Button,
                  { key: 'confirm', primary: true, disabled: props.busy === true, onClick: () => props.onConfirm(entry.id) },
                  t('reflux.confirm'),
                ),
                h(
                  Button,
                  { key: 'discard', danger: true, disabled: props.busy === true, onClick: () => props.onDiscard(entry.id) },
                  t('reflux.discard'),
                ),
              ]
            : [
                h(Button, { key: 'edit', onClick: () => props.onEdit(entry.id) }, t('row.edit')),
                h(
                  Button,
                  {
                    key: 'delete',
                    danger: props.armed === true,
                    disabled: props.busy === true,
                    onClick: () => props.onDelete(entry.id),
                  },
                  props.armed === true ? t('row.confirm') : t('row.delete'),
                ),
              ],
        ),
      ])
    }

    function Editor(props) {
      const editor = props.value
      const setEditor = props.onChange
      const update = (patch) => setEditor({ ...editor, ...patch })
      return h('div', { className: 'kb-editor' }, [
        h('div', { key: 'head', className: 'kb-editor-head' }, t(editor.id ? 'editor.edit' : 'editor.new')),
        h(
          Field,
          { key: 'title', label: t('editor.field.title') },
          h('input', {
            className: 'kb-input',
            value: editor.title,
            placeholder: t('editor.field.titlePlaceholder'),
            maxLength: 200,
            autoFocus: true,
            onChange: (event) => update({ title: event.target.value }),
          }),
        ),
        h('div', { key: 'grid', className: 'kb-grid2' }, [
          h(
            Field,
            { key: 'tags', label: t('editor.field.tags') },
            h('input', {
              className: 'kb-input',
              value: editor.tags,
              placeholder: t('editor.field.tagsPlaceholder'),
              onChange: (event) => update({ tags: event.target.value }),
            }),
          ),
          h(
            Field,
            { key: 'source', label: t('editor.field.source') },
            h('input', {
              className: 'kb-input',
              value: editor.source,
              placeholder: t('editor.field.sourcePlaceholder'),
              onChange: (event) => update({ source: event.target.value }),
            }),
          ),
        ]),
        h(
          Field,
          { key: 'content', label: t('editor.field.content') },
          h('textarea', {
            className: 'kb-textarea',
            value: editor.content,
            placeholder: t('editor.field.contentPlaceholder'),
            onChange: (event) => update({ content: event.target.value }),
            onKeyDown: (event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                props.onSave()
              }
            },
          }),
        ),
        editor.error ? h('div', { key: 'error', className: 'kb-error' }, editor.error) : null,
        h('label', { key: 'sensitive', className: 'kb-switch' }, [
          h('input', {
            type: 'checkbox',
            className: 'kb-switch-input',
            checked: editor.sensitive === true,
            onChange: (event) => update({ sensitive: event.target.checked, sensitiveTouched: true }),
          }),
          h('span', { key: 'track', className: 'kb-switch-track', 'aria-hidden': true }, [
            h('span', { key: 'thumb', className: 'kb-switch-thumb' }),
          ]),
          h('span', { key: 'text', className: 'kb-switch-text' }, [
            h('span', { key: 't', className: 'kb-switch-title' }, t('editor.sensitive')),
            h('span', { key: 'h', className: 'kb-switch-hint' }, t('editor.sensitiveHint')),
          ]),
        ]),
        h('div', { key: 'actions', className: 'kb-editor-actions' }, [
          h('span', { key: 'hint', className: 'kb-editor-hint' }, t('editor.hint')),
          h(Button, { key: 'cancel', onClick: props.onCancel, disabled: editor.saving === true }, t('editor.cancel')),
          h(
            Button,
            { key: 'save', primary: true, onClick: props.onSave, disabled: editor.saving === true },
            editor.saving === true ? t('editor.saving') : t('editor.save'),
          ),
        ]),
      ])
    }

    /**
     * Global boot prompt: mounted from `shell.overlay` when the page loads.
     * It covers the app while the vault is locked and disappears once the
     * passphrase is accepted. "Skip" keeps the app usable and the vault locked.
     */
    function UnlockOverlay() {
      const [state, setState] = useState({ known: false, locked: false })
      const [passphrase, setPassphrase] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [dismissed, setDismissed] = useState(false)

      const refresh = useCallback(async () => {
        try {
          const data = await post('/status', {})
          setState({ known: true, locked: data?.status?.locked === true })
        } catch {
          /* the host may be restarting; keep the last known state */
        }
      }, [])

      useEffect(() => {
        refresh()
        const onFocus = () => {
          void refresh()
        }
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refresh()
        }, 5000)
        window.addEventListener('focus', onFocus)
        window.addEventListener(UNLOCK_EVENT, onFocus)
        document.addEventListener('visibilitychange', onFocus)
        return () => {
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
          window.removeEventListener(UNLOCK_EVENT, onFocus)
          document.removeEventListener('visibilitychange', onFocus)
        }
      }, [refresh])

      const submit = async () => {
        if (busy === true) return
        if (passphrase === '') {
          setError(t('lock.short'))
          return
        }
        setBusy(true)
        setError('')
        try {
          const data = await post('/unlock', { passphrase })
          setPassphrase('')
          setState({ known: true, locked: data?.status?.locked === true })
          announceUnlock()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      if (dismissed === true || state.known !== true || state.locked !== true) return null

      return h(
        'div',
        { className: 'kb-modal-backdrop' },
        h(
          'div',
          { className: 'kb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('lock.title') },
          [
            h('div', { key: 't', className: 'kb-lock-title' }, t('lock.title')),
            h('div', { key: 'h', className: 'kb-lock-hint' }, t('lock.bootHint')),
            h('input', {
              key: 'p',
              className: 'kb-input',
              type: 'password',
              value: passphrase,
              autoFocus: true,
              placeholder: t('lock.passphrase'),
              onChange: (event) => {
                setPassphrase(event.target.value)
                setError('')
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              },
            }),
            error !== '' ? h('div', { key: 'e', className: 'kb-error' }, error) : null,
            h('div', { key: 'a', className: 'kb-editor-actions' }, [
              h(Button, { key: 'skip', onClick: () => setDismissed(true), disabled: busy === true }, t('lock.skip')),
              h(
                Button,
                { key: 'u', primary: true, onClick: submit, disabled: busy === true },
                busy === true ? t('lock.unlocking') : t('lock.unlock'),
              ),
            ]),
          ],
        ),
      )
    }

    function KnowledgeBasePage() {
      const [entries, setEntries] = useState([])
      const [total, setTotal] = useState(0)
      const [file, setFile] = useState('')
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [query, setQuery] = useState('')
      const [settings, setSettings] = useState({ recall: true, reflux: { lastRunAt: null, lastSummary: '' } })
      const [editor, setEditor] = useState(null)
      const [armed, setArmed] = useState('')
      const [busy, setBusy] = useState(false)
      const [pending, setPending] = useState([])
      const [counts, setCounts] = useState({ confirmed: 0, pending: 0 })
      const [reflux, setReflux] = useState({ lastRunAt: null, lastSummary: '' })
      const [index, setIndex] = useState({ entries: 0, listed: 0, chars: 0, budget: 4000, truncated: 0 })
      const [search, setSearch] = useState({ misses: 0, lastMissAt: null, lastMissQuery: '' })
      const [sensitive, setSensitive] = useState(0)
      const [refluxBusy, setRefluxBusy] = useState(false)
      const [status, setStatus] = useState({ locked: false, encrypted: false, total: 0 })
      const [unlockInput, setUnlockInput] = useState('')
      const [unlockError, setUnlockError] = useState('')
      const [unlockModal, setUnlockModal] = useState(false)
      const [auth, setAuth] = useState(null)
      const [authBusy, setAuthBusy] = useState(false)

      const alive = useRef(true)
      const armTimer = useRef(null)
      const noticeTimer = useRef(null)
      const primed = useRef(false)

      const flash = useCallback((message) => {
        setNotice(message)
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => {
          noticeTimer.current = null
          if (alive.current) setNotice('')
        }, 2600)
      }, [])

      const load = useCallback(async (nextQuery) => {
        setLoading(true)
        setError('')
        try {
          const data = await post('/list', { q: nextQuery ?? '' })
          if (!alive.current) return
          setEntries(Array.isArray(data.entries) ? data.entries : [])
          setPending(Array.isArray(data.pending) ? data.pending : [])
          setTotal(Number(data.total ?? 0))
          if (data.counts) setCounts(data.counts)
          setFile(typeof data.file === 'string' ? data.file : '')
          if (data.status) setStatus(data.status)
          if (data.reflux) setReflux(data.reflux)
          if (data.index) setIndex(data.index)
          if (data.search) setSearch(data.search)
          setSensitive(Number(data.sensitive ?? 0))
          if (data.settings) setSettings(normalizeSettings(data.settings))
        } catch (failure) {
          if (!alive.current) return
          setError(`${t('error.load')}：${failure?.message ?? failure}`)
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [])

      useEffect(() => {
        alive.current = true
        load('')
        const onUnlocked = () => {
          void load('')
        }
        window.addEventListener(UNLOCK_EVENT, onUnlocked)
        return () => {
          alive.current = false
          window.removeEventListener(UNLOCK_EVENT, onUnlocked)
          if (armTimer.current !== null) clearTimeout(armTimer.current)
          if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        }
      }, [load])

      useEffect(() => {
        if (!primed.current) {
          primed.current = true
          return undefined
        }
        const timer = setTimeout(() => load(query), 300)
        return () => clearTimeout(timer)
      }, [query, load])

      const startCreate = () => {
        setArmed('')
        setEditor({
          id: '',
          title: '',
          tags: '',
          source: '',
          content: '',
          sensitive: false,
          sensitiveTouched: false,
          saving: false,
          error: '',
        })
      }

      const startEdit = async (id) => {
        setArmed('')
        setEditor({
          id,
          title: '',
          tags: '',
          source: '',
          content: '',
          sensitive: false,
          sensitiveTouched: false,
          saving: false,
          error: '',
          loading: true,
        })
        try {
          const data = await post('/get', { id })
          if (!alive.current) return
          const entry = data.entry ?? {}
          setEditor({
            id,
            title: String(entry.title ?? ''),
            tags: Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
            source: String(entry.source ?? ''),
            content: String(entry.content ?? ''),
            sensitive: entry.sensitive === true,
            sensitiveTouched: false,
            saving: false,
            error: '',
          })
        } catch (failure) {
          if (!alive.current) return
          setEditor((current) => (current === null ? current : { ...current, error: String(failure?.message ?? failure) }))
        }
      }

      const save = async () => {
        if (editor === null || editor.saving === true) return
        const title = editor.title.trim()
        const content = editor.content.trim()
        if (title === '' || content === '') {
          setEditor({ ...editor, error: t('editor.required') })
          return
        }
        setEditor({ ...editor, saving: true, error: '' })
        try {
          const payload = {
            id: editor.id === '' ? undefined : editor.id,
            title,
            content,
            tags: editor.tags,
            source: editor.source,
          }
          if (editor.sensitiveTouched === true) payload.sensitive = editor.sensitive === true
          await post('/save', payload)
          if (!alive.current) return
          setEditor(null)
          flash(t('notice.saved'))
          await load(query)
        } catch (failure) {
          if (!alive.current) return
          setEditor((current) =>
            current === null ? current : { ...current, saving: false, error: `${t('error.save')}：${failure?.message ?? failure}` },
          )
        }
      }

      const remove = async (id) => {
        if (busy) return
        if (armed !== id) {
          setArmed(id)
          if (armTimer.current !== null) clearTimeout(armTimer.current)
          armTimer.current = setTimeout(() => {
            armTimer.current = null
            if (alive.current) setArmed('')
          }, 4000)
          return
        }
        if (armTimer.current !== null) clearTimeout(armTimer.current)
        armTimer.current = null
        setArmed('')
        setBusy(true)
        try {
          await post('/delete', { id })
          if (!alive.current) return
          flash(t('notice.deleted'))
          await load(query)
        } catch (failure) {
          if (alive.current) setError(`${t('error.delete')}：${failure?.message ?? failure}`)
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const changeSettings = async (patch) => {
        const previous = settings
        setSettings(normalizeSettings({ ...settings, ...patch }))
        try {
          const data = await post('/settings', patch)
          if (alive.current) setSettings(normalizeSettings(data.settings))
        } catch (failure) {
          if (!alive.current) return
          setSettings(previous)
          setError(`${t('error.settings')}：${failure?.message ?? failure}`)
        }
      }

      const confirmPending = async (id) => {
        if (refluxBusy === true) return
        setRefluxBusy(true)
        try {
          const data = await post('/confirm', id === undefined ? {} : { ids: [id] })
          if (!alive.current) return
          flash(`${t('reflux.confirm')} × ${data.confirmed ?? 0}`)
          await load(query)
        } catch (failure) {
          if (alive.current) setError(`${t('error.save')}：${failure?.message ?? failure}`)
        } finally {
          if (alive.current) setRefluxBusy(false)
        }
      }

      const discardPending = async (id) => {
        if (refluxBusy === true) return
        setRefluxBusy(true)
        try {
          await post('/delete', { id })
          if (!alive.current) return
          flash(t('notice.deleted'))
          await load(query)
        } catch (failure) {
          if (alive.current) setError(`${t('error.delete')}：${failure?.message ?? failure}`)
        } finally {
          if (alive.current) setRefluxBusy(false)
        }
      }

      const unlock = async () => {
        if (unlockInput === '') {
          setUnlockError(t('lock.short'))
          return
        }
        setAuthBusy(true)
        setUnlockError('')
        try {
          const data = await post('/unlock', { passphrase: unlockInput })
          if (!alive.current) return
          setStatus(data.status)
          setUnlockInput('')
          setUnlockModal(false)
          announceUnlock()
          await load('')
        } catch (failure) {
          if (alive.current) setUnlockError(String(failure?.message ?? failure))
        } finally {
          if (alive.current) setAuthBusy(false)
        }
      }

      const lockNow = async () => {
        try {
          const data = await post('/lock', {})
          if (!alive.current) return
          setStatus(data.status)
          setEntries([])
          setTotal(0)
          setEditor(null)
          setAuth(null)
          setQuery('')
          setUnlockInput('')
          setUnlockError('')
        } catch (failure) {
          if (alive.current) setError(`${t('error.settings')}：${failure?.message ?? failure}`)
        }
      }

      const submitAuth = async () => {
        if (auth === null) return
        const next = auth.next.trim()
        if (next.length < 8) {
          setAuth({ ...auth, error: t('lock.short') })
          return
        }
        if (next !== auth.confirm.trim()) {
          setAuth({ ...auth, error: t('lock.mismatch') })
          return
        }
        setAuthBusy(true)
        try {
          const body = auth.mode === 'change' ? { current: auth.current, next } : { next }
          const data = await post('/passphrase', body)
          if (!alive.current) return
          setStatus(data.status)
          setAuth(null)
          flash(t('notice.saved'))
          await load(query)
        } catch (failure) {
          if (alive.current) {
            setAuth((current) =>
              current === null ? current : { ...current, error: String(failure?.message ?? failure) },
            )
          }
        } finally {
          if (alive.current) setAuthBusy(false)
        }
      }

      const unlockDialog = () =>
        h(
          'div',
          {
            key: 'unlock-modal',
            className: 'kb-modal-backdrop',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) setUnlockModal(false)
            },
          },
          h(
            'div',
            {
              key: 'card',
              className: 'kb-modal',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t('lock.title'),
            },
            [
              h('div', { key: 't', className: 'kb-lock-title' }, t('lock.title')),
              h('div', { key: 'h', className: 'kb-lock-hint' }, t('lock.hint')),
              h('input', {
                key: 'p',
                className: 'kb-input',
                type: 'password',
                value: unlockInput,
                autoFocus: true,
                placeholder: t('lock.passphrase'),
                onChange: (event) => {
                  setUnlockInput(event.target.value)
                  setUnlockError('')
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    unlock()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setUnlockModal(false)
                  }
                },
              }),
              unlockError !== '' ? h('div', { key: 'e', className: 'kb-error' }, unlockError) : null,
              h('div', { key: 'a', className: 'kb-editor-actions' }, [
                h(Button, { key: 'cancel', onClick: () => setUnlockModal(false), disabled: authBusy === true }, t('lock.cancel')),
                h(
                  Button,
                  { key: 'u', primary: true, onClick: unlock, disabled: authBusy === true },
                  authBusy === true ? t('lock.unlocking') : t('lock.unlock'),
                ),
              ]),
            ],
          ),
        )

      if (status.locked === true) {
        return h('div', { className: 'kb-page' }, [
          h('div', { key: 'head', className: 'kb-head' }, [
            h('div', { key: 'titles', className: 'kb-titles' }, [
              h('div', { key: 't', className: 'kb-title' }, t('page.title')),
              h('div', { key: 's', className: 'kb-sub' }, t('lock.encrypted')),
            ]),
          ]),
          h('div', { key: 'lock', className: 'kb-card kb-lock' }, [
            h('div', { key: 't', className: 'kb-lock-title' }, t('lock.title')),
            h('div', { key: 'h', className: 'kb-lock-hint' }, t('lock.hint')),
            h('div', { key: 'a', className: 'kb-editor-actions' }, [
              h(Button, { key: 'open', primary: true, onClick: () => setUnlockModal(true) }, t('lock.unlock')),
            ]),
            h('div', { key: 'hint', className: 'kb-lock-hint' }, t('lock.autoHint')),
          ]),
          unlockModal ? unlockDialog() : null,
        ])
      }

      const body = []

      if (auth !== null) {
        body.push(
          h('div', { key: 'auth', className: 'kb-card kb-lock' }, [
            h('div', { key: 't', className: 'kb-lock-title' }, t(auth.mode === 'change' ? 'lock.changeTitle' : 'lock.setupTitle')),
            auth.mode === 'change'
              ? h(
                  Field,
                  { key: 'current', label: t('lock.current') },
                  h('input', {
                    className: 'kb-input',
                    type: 'password',
                    value: auth.current,
                    onChange: (event) => setAuth({ ...auth, current: event.target.value, error: '' }),
                  }),
                )
              : h('div', { key: 'h', className: 'kb-lock-hint' }, t('lock.setupHint')),
            h(
              Field,
              { key: 'next', label: t('lock.next') },
              h('input', {
                className: 'kb-input',
                type: 'password',
                value: auth.next,
                autoFocus: auth.mode !== 'change',
                onChange: (event) => setAuth({ ...auth, next: event.target.value, error: '' }),
              }),
            ),
            h(
              Field,
              { key: 'confirm', label: t('lock.confirm') },
              h('input', {
                className: 'kb-input',
                type: 'password',
                value: auth.confirm,
                onChange: (event) => setAuth({ ...auth, confirm: event.target.value, error: '' }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitAuth()
                  }
                },
              }),
            ),
            auth.error ? h('div', { key: 'e', className: 'kb-error' }, auth.error) : null,
            h('div', { key: 'a', className: 'kb-editor-actions' }, [
              h(Button, { key: 'c', onClick: () => setAuth(null), disabled: authBusy }, t('lock.cancel')),
              h(
                Button,
                { key: 's', primary: true, onClick: submitAuth, disabled: authBusy },
                auth.mode === 'change' ? t('lock.submitChange') : t('lock.submitSetup'),
              ),
            ]),
          ]),
        )
      }
      if (pending.length > 0) {
        body.push(
          h('div', { key: 'pending', className: 'kb-pending' }, [
            h('div', { key: 'hd', className: 'kb-section-head' }, [
              h('span', { key: 't', className: 'kb-section-title' }, `${t('reflux.pendingTitle')}（${pending.length}）`),
              h(
                Button,
                { key: 'all', primary: true, disabled: refluxBusy === true, onClick: () => confirmPending() },
                t('reflux.confirmAll'),
              ),
            ]),
            h('div', { key: 'hint', className: 'kb-lock-hint' }, t('reflux.pendingHint')),
            ...pending.map((entry) =>
              h(EntryRow, {
                key: entry.id,
                entry,
                mode: 'pending',
                busy: refluxBusy,
                onConfirm: confirmPending,
                onDiscard: discardPending,
              }),
            ),
          ]),
        )
      }

      if (editor !== null) {
        body.push(
          h(Editor, {
            key: 'editor',
            value: editor,
            onChange: setEditor,
            onCancel: () => setEditor(null),
            onSave: save,
          }),
        )
      } else if (loading && entries.length === 0) {
        body.push(h('div', { key: 'loading', className: 'kb-empty' }, h('div', { className: 'kb-empty-hint' }, t('page.loading'))))
      } else if (entries.length === 0) {
        body.push(
          h('div', { key: 'empty', className: 'kb-empty' }, [
            h(
              'div',
              { key: 't', className: 'kb-empty-title' },
              query === '' ? t('page.empty.title') : t('page.noresult.title'),
            ),
            h(
              'div',
              { key: 'h', className: 'kb-empty-hint' },
              query === '' ? t('page.empty.hint') : t('page.noresult.hint'),
            ),
            query === ''
              ? h('div', { key: 'a', className: 'kb-empty-actions' }, [
                  h(Button, { primary: true, onClick: startCreate }, t('page.add')),
                ])
              : null,
          ]),
        )
      } else {
        for (const entry of entries) {
          body.push(
            h(EntryRow, {
              key: entry.id,
              entry,
              armed: armed === entry.id,
              busy,
              onEdit: startEdit,
              onDelete: remove,
            }),
          )
        }
      }

      const refluxStatusText = () => {
        const labels = {
          idle: t('reflux.result.idle'),
          buffered: t('reflux.result.buffered'),
          created: t('reflux.result.created'),
          updated: t('reflux.result.updated'),
          unchanged: t('reflux.result.unchanged'),
          'already-recorded': t('reflux.result.already-recorded'),
          'empty-recap': t('reflux.result.empty-recap'),
          'no-session-events': t('reflux.result.no-session-events'),
          'no-model': t('reflux.result.no-model'),
          'no-knowledge': t('reflux.result.no-knowledge'),
          locked: t('reflux.result.locked'),
          error: t('reflux.result.error'),
        }
        const parts = [reflux.lastRunAt ? fill(t('reflux.lastRun'), { time: formatTime(reflux.lastRunAt) }) : t('reflux.never')]
        if (reflux.lastSummary) parts.push(reflux.lastSummary)
        if (reflux.lastAttemptAt) {
          const attempt = fill(t('reflux.attempt'), { time: formatTime(reflux.lastAttemptAt) })
          const label = labels[String(reflux.lastResult ?? '')]
          parts.push(label === undefined ? attempt : `${attempt} · ${label}`)
        }
        return parts.join(' · ')
      }

      return h('div', { className: 'kb-page' }, [
        h('div', { key: 'head', className: 'kb-head' }, [
          h('div', { key: 'titles', className: 'kb-titles' }, [
            h('div', { key: 't', className: 'kb-title' }, t('page.title')),
            h('div', { key: 's', className: 'kb-sub' }, fill(t('page.subtitle'), { n: total })),
          ]),
          h(
            'div',
            { key: 'actions', className: 'kb-actions' },
            [
              h('span', { key: 'status', className: 'kb-status' }, [
                h('span', {
                  key: 'dot',
                  className: 'kb-status-dot',
                  'data-locked': status.encrypted === true ? '0' : '1',
                }),
                status.encrypted === true ? t('lock.encrypted') : t('lock.plain'),
              ]),
              status.encrypted === true
                ? h(Button, { key: 'locknow', onClick: lockNow }, t('lock.lockNow'))
                : null,
              h(
                Button,
                {
                  key: 'auth',
                  onClick: () =>
                    setAuth(
                      status.encrypted === true
                        ? { mode: 'change', current: '', next: '', confirm: '', error: '' }
                        : { mode: 'setup', current: '', next: '', confirm: '', error: '' },
                    ),
                },
                status.encrypted === true ? t('lock.change') : t('lock.setup'),
              ),
              h(Button, { key: 'add', primary: true, onClick: startCreate, disabled: editor !== null }, t('page.add')),
            ],
          ),
        ]),
        status.encrypted === true
          ? null
          : h('div', { key: 'warn', className: 'kb-warn' }, [
              h('span', { key: 't', className: 'kb-warn-text' }, t('lock.plainWarning')),
              h(
                Button,
                {
                  key: 'b',
                  onClick: () => setAuth({ mode: 'setup', current: '', next: '', confirm: '', error: '' }),
                },
                t('lock.setup'),
              ),
            ]),
        h('div', { key: 'hint', className: 'kb-hint' }, t('page.hint')),
        h('div', { key: 'settings', className: 'kb-card kb-settings' }, [
          h('label', { key: 'switch', className: 'kb-switch' }, [
            h('input', {
              type: 'checkbox',
              className: 'kb-switch-input',
              checked: settings.recall,
              onChange: (event) => changeSettings({ recall: event.target.checked }),
            }),
            h('span', { key: 'track', className: 'kb-switch-track', 'aria-hidden': true }, [
              h('span', { key: 'thumb', className: 'kb-switch-thumb' }),
            ]),
            h('span', { key: 'text', className: 'kb-switch-text' }, [
              h('span', { key: 't', className: 'kb-switch-title' }, t('settings.recall')),
              h('span', { key: 'h', className: 'kb-switch-hint' }, t('settings.recallHint')),
            ]),
          ]),
          h('div', { key: 'reflux', className: 'kb-reflux' }, [
            h('div', { key: 'text', className: 'kb-switch-text' }, [
              h('span', { key: 't', className: 'kb-switch-title' }, t('reflux.title')),
              h('span', { key: 'h', className: 'kb-switch-hint' }, t('reflux.hint')),
            ]),
            h('div', { key: 'meta', className: 'kb-reflux-meta' }, [
              h('span', { key: 'when', className: 'kb-reflux-when' }, refluxStatusText()),
            ]),
          ]),
          h('div', { key: 'health', className: 'kb-reflux' }, [
            h('div', { key: 'text', className: 'kb-switch-text' }, [
              h('span', { key: 't', className: 'kb-switch-title' }, t('health.title')),
              h(
                'span',
                { key: 'h', className: 'kb-switch-hint' },
                fill(t('health.index'), {
                  used: String(index.chars ?? 0),
                  budget: String(index.budget ?? 4000),
                  dropped: String(index.truncated ?? 0),
                }),
              ),
              h(
                'span',
                { key: 'm', className: 'kb-switch-hint' },
                fill(t('health.search'), {
                  misses: String(search.misses ?? 0),
                  sensitive: String(sensitive ?? 0),
                }),
              ),
            ]),
          ]),
        ]),
        h('div', { key: 'toolbar', className: 'kb-toolbar' }, [
          h(
            'div',
            { key: 'search', className: 'kb-search' },
            h('input', {
              className: 'kb-input',
              value: query,
              placeholder: t('page.search'),
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          h('span', { key: 'count', className: 'kb-count' }, fill(t('page.count'), { n: total })),
          h(Button, { key: 'refresh', onClick: () => load(query), disabled: loading }, t('page.refresh')),
        ]),
        notice !== '' ? h('div', { key: 'notice', className: 'kb-notice' }, notice) : null,
        error !== '' ? h('div', { key: 'error', className: 'kb-error' }, error) : null,
        h('div', { key: 'body', className: 'kb-body' }, body),
        file !== ''
          ? h(
              'div',
              { key: 'footer', className: 'kb-footer' },
              h('span', { className: 'kb-mono', title: file }, fill(t('footer.file'), { path: file })),
            )
          : null,
      ])
    }

    /* --------------------------------------------------------------------- */
    /* Wiring                                                                */
    /* --------------------------------------------------------------------- */

    function apply(ctx) {
      t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-knowledge-base-styles'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'knowledge-base: styles')

      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'knowledge-base: zh dictionary')
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'knowledge-base: en dictionary')

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: 'knowledge-base-unlock', order: 200, locale: NS },
              UnlockOverlay,
            ),
          ),
        'knowledge-base: boot unlock prompt',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'knowledge-base',
                order: 22,
                label: () => t('nav.label'),
                locale: NS,
              },
              KnowledgeBasePage,
            ),
          ),
        'knowledge-base: settings section',
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
