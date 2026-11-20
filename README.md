# 知识库（@night-ended-dawn-not-broken/dsh-knowledge-base）

手动录入资料，并让 Harness 的模型在**每次联网检索时先检索知识库**，以知识库内容为优先标准回复。联网检索本身照常进行，不会被拦截。知识库支持 **AES-256-GCM 落盘加密 + 口令锁定**。

> npm 上的 `dsh-knowledge-base` 已被其他作者占用，因此本包发布在 `@night-ended-dawn-not-broken` scope 下。

## 安装

要求 DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`，Node.js 20+。

从 npm 安装：

```sh
dsh plugin --profile desktop add @night-ended-dawn-not-broken/dsh-knowledge-base
```

从 GitHub 安装（纯 JavaScript，无需构建步骤）：

```sh
dsh plugin --profile desktop add github:Night-ended-dawn-not-broken/dsh-knowledge-base
```

从本地目录安装：

```sh
dsh plugin --profile desktop add ./dsh-knowledge-base
```

安装后重启 Harness，在「设置 → 知识库」中录入资料。

## 组成

| 部分 | 说明 |
| --- | --- |
| 设置页「知识库」 | 新增 / 编辑 / 删除 / 搜索资料，设置口令、锁定、开关自动附带 |
| `kb_search` | 检索知识库，返回标题、标签、相关度和正文（模型工具） |
| `kb_add` | 用户要求长期保存时，由模型写入一条资料（模型工具） |
| 系统提示词 | 「知识库优先」规则 + 条目索引；敏感条目只露标题 |
| 联网前置检索 | 每次 `web_search` 执行前，先用检索词查一遍知识库 |
| 结果附带 | 命中时把知识库内容放在 `web_search` 结果最前面 |
| 知识点整理 | 每轮对话只把内容缓存起来；每天 12:05 的自动化任务统一提炼成知识点 |

修改和删除只有设置页能做：模型只拿到 `kb_search` / `kb_add`，避免网页里的不可信内容诱导它删改权威资料。

## 插件协议（提示词第 8 条，可选）

自 `v1.1.0` 起，系统提示词会附带一条「插件协议」：

> 在任何对话里创建、改造、优化或发布本地插件之前，先 `kb_search`「插件改造与发布流程」读完该条目再动手；改完按其中五步执行（改代码 → 跑测试 → commit → push），并在回复里回报提交号、改动文件、测试结果与推送状态。

这条规则来自作者本机的插件工作流，**不会自动创建任何知识库条目**。使用方式：

- **想启用**：在「设置 → 知识库」新建一条标题为「插件改造与发布流程」的条目，写入你的仓库路径、测试命令、提交与推送约定。之后模型在插件任务开始前会先检索它。
- **不想启用**：不建该条目即可。`kb_search` 未命中时这条规则不会产生额外动作；也可以删除 `index.js` 中 `promptSectionText()` 的第 8 条后重新安装。
- **权限不变**：它只影响提示词，不会给模型新增读写权限，也不会绕过知识库锁定、加密或 `kb_search` / `kb_add` 的工具边界。

如果只是把本插件当作普通知识库使用，可以忽略本节。

## 知识点整理（对话 → 缓存 → 每日提炼 → 待确认 → 检索）

- **不再每轮调用模型**：每轮对话结束只做一件事——把该轮的用户提问与最近几条回答，去掉机器注入块和凭据行后，追加进缓冲区 `reflux-buffer.json`（`buffer.js`，最多 600 段、30 万字、保留 72 小时）。子会话（`origin: subagent`）不入缓冲。
- **每天 12:05 的自动化任务**（可自行创建定时任务）读取缓冲区，按「可复用的方法或知识」提炼：通用规则、约定、判断标准、操作步骤、固定地址/入口/端口、明确的偏好与结论；忽略某次任务的进度与结果、一次性排查过程、示例数据、寒暄、对「测试」「继续」的回应。
- **按知识库现有形式写入**：标题是主题短语（≤20 字，无「对话：」前缀、无省略号）；正文第一行「知识点整理（YYYY-MM-DD）」，其后每条一行以「- 」开头，句子完整、不截断。
- **同主题合并**：与现有条目同主题时合并进原条目（`/save` 传 id），不重复建条。
- **待确认区**：新知识点以 `state: pending`、`origin: reflux`、标签 `回流,知识点` 写入，不进 `kb_search`、不进提示词索引、不随联网检索附带；确认后才进入检索，丢弃则删除。
- **凭据不出本机**：命中密码/密钥/令牌等关键词的那一行在进入缓冲区之前就被丢弃。
- **接口**（供自动化任务使用，均需 `x-dsh-plugin: knowledge-base` 头）：`POST /buffer`（读缓冲）、`POST /buffer/clear`（整理完成后清空）、`POST /pending`（写入待确认知识点）。
- 知识库锁定时不缓存（`lastResult: locked`）；缓冲为空时任务直接结束，不清空。
- **诊断**：`/status` 与 `/list` 返回 `reflux: { lastAttemptAt, lastResult, lastEntryId, lastError }`，`lastResult` 取值 `buffered`/`unchanged`/`empty-recap`/`no-session-events`/`locked`/`error`，设置页的「最近一次尝试」也显示它。

## 加密与锁定

- **口令加密**：设置页「设置口令」后，整份知识库用 `scrypt` 派生密钥 + `AES-256-GCM` 加密写盘。文件里只剩盐、IV、认证标签和密文。
- **口令不落盘**：口令只用于当次运行，内存中保留派生密钥；锁定或插件卸载时密钥被清零，明文文档从内存丢弃。
- **锁定**：手动「立即锁定」，或进程重启（加密文件重新加载即为锁定）。锁定后：
  - 文件仍是密文，工具与页面接口都拿不到内容（页面接口返回 `423 LOCKED`）；
  - 系统提示词切换为「已锁定」提示，不再包含任何条目；
  - `kb_search` / `kb_add` 报错并提示去设置页解锁。
- **打开即校验**：打开「设置 → 知识库」页面时，若处于锁定状态会**自动弹窗**要求输入口令；校验通过后本次运行内**不再自动锁定**，只有手动锁定或重启 Harness 才需要重新校验。
- **解锁**：输入口令；口令错误时 GCM 认证失败，不会泄露任何内容。
- **修改口令**：需要验证当前口令，之后用新口令重新加密。
- **旧数据迁移**：已有的明文 `kb.json` 仍可读取，页面会用醒目提示要求设置口令；设置后原文件被密文就地替换。

## 敏感条目

- 标题或正文命中 `密码 / 口令 / 密钥 / 令牌 / 验证码 / secret / password / api_key / token` 等关键词时，条目自动标记为「敏感」；编辑时可手动覆盖。
- 敏感条目**不会**进入系统提示词的摘要、**不会**随联网检索自动附带；只有模型显式调用 `kb_search` 且确实命中时才会返回。
- 页面列表中的敏感条目预览会被遮罩，需点开编辑才能看到全文。
- **永远不进入向量索引**：将来启用向量召回时，以 `sensitive === true` 作为排除集（`/status` 的 `sensitive` 计数就是该集合的大小）。敏感条目只保留当前的词法检索形态，既不被嵌入模型读走，也不随向量落盘。

## 检索健康度（向量化的决策依据）

- `/status` 与 `/list` 返回三组指标：
  - `index: { entries, listed, chars, budget, truncated }` —— 系统提示词索引的占用与溢出条数（预算 4000 字，溢出后未列出的条目模型看不到，只能靠 `kb_search`）；
  - `search: { misses, lastMissAt, lastMissQuery }` —— 检索未命中的累计次数与最近一次查询；
  - `sensitive` —— 将来不进向量库的条目数。
- 设置页「检索健康度」直接显示这些数字。
- 迁移判据：`index.truncated > 0`（约 36 条）或 `search.misses` 持续增长时，才值得引入向量召回；在此之前词法足够。

## 优先级的实现方式

1. **提示词层**：声明知识库是权威资料，冲突时以知识库为准，并标注来源。
2. **检索层**：`tools/pre-execute` 在 `web_search` 真正执行前，用同一检索词查库并缓存命中结果——先检索、后联网，但不阻断。
3. **结果层**：`tools/post-execute` 把缓存的知识库摘要前置到 `web_search` 结果里，网络结果原样保留在后面。

设置页的开关（默认开）控制第 2、3 层是否自动进行；关掉后仍可靠提示词与 `kb_search` 手动检索。

## 数据

- 位置：`%DSH_PROFILE_DIR%\knowledge-base\kb.json`（未设置时回退到 `%DSH_HOME%\knowledge-base\kb.json`）
- 明文格式：`{ version: 2, settings: { recall, reflux: { lastRunAt, lastSummary }, search: { misses, lastMissAt, lastMissQuery } }, entries: [...] }`
- 条目字段：`state`（`confirmed` / `pending`）、`origin`（`manual` / `reflux`）、`sensitive`、`sessionId`、`reason`
- 旧版 `settings.gate` 会自动读成 `recall`；旧条目默认 `confirmed`
- 密文格式：`{ version: 2, encrypted: true, alg: 'dsh-kb-aes-256-gcm', kdf: { name: 'scrypt', N, r, p, salt }, iv, tag, data }`
- 写入：临时文件 + 原子替换；文件损坏时自动备份为 `kb.json.corrupt-<时间戳>` 并以空库启动
- 设置页底部会显示实际数据文件路径，便于备份

## 测试

```powershell
node test/store.test.mjs   # 存储、检索、敏感标记、回流待确认/确认/原地更新、加密/锁定/改口令
node test/reflux.test.mjs  # 会话摘要抽取、凭据行剔除、机器注入块剥离、尾部截取
node test/buffer.test.mjs  # 缓冲区追加去重、字符计数、持久化、清空、保留窗口、损坏恢复
node test/host.test.mjs    # 工具、提示词、前置检索、结果附带、轮末回流入库/确认、锁定路由（mock ctx）
```

也可直接运行 `npm test` 执行全部测试。

Host 端改动只有在重启 Harness 后才会生效；若在 `cordis.patch.yml` 里给 `hmr` 配置了模块根，保存配置即可触发热替换。

## 卸载

在 设置 → 插件 中禁用或移除本 bundle。数据文件不会被删除，重新安装后仍可用（加密的需口令解锁）。
