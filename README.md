# 个人信息管家（微信小程序）

随手记录零散想法、资料与待办；自动分类、总结、抽取重点并关联相关内容；支持关键词检索、智能问答、待办整理，并基于已有内容生成阶段总结与后续行动建议。

## 技术栈

- 原生微信小程序（WXML / WXSS / 原生 JS，无框架、无 Taro）
- 云服务：PostgreSQL（`entries` / `todos` 两张表，RLS 按 owner 隔离）+ WorkBuddy Auth + 大模型 API
- `@tencent-ai/workbuddy-cloud-sdk` 的 `/miniprogram` 子路径
- AI 层可插拔：优先走大模型，模型不可用时自动回落本地规则引擎，功能不中断

## 目录结构

```
personal-info-keeper/
├── app.js / app.json / app.wxss        应用入口、页面与 tabBar 配置、全局样式
├── project.config.json                 编译配置；packOptions.ignore 当前只排除 /minitest
├── pages/
│   ├── login/      登录：**应用首屏**（app.json 的 pages[0]）。SCREEN 07 版式：全局 masthead 刊头 + 来源引导 + 字段标签 + 居中朱红主按钮 + 协议门禁（提交反馈框、微信说明、页脚均已按本人要求删除）
│   ├── index/      记录：快速输入、自动分类、类型筛选
│   ├── search/     检索：关键词搜索 + 智能问答
│   ├── todo/       待办：抽取汇总、优先级排序、勾选与删除
│   ├── report/     总结：阶段小结、内容分布、行动建议
│   ├── detail/     详情：摘要、重点、关键词、关联内容
│   ├── profile/    我的：内置头像集、昵称编辑、账号与安全入口、数据统计、智能引擎、退出登录
│   ├── account/    账号与安全：登录账号（掩码）、**登录方式绑定（微信 / 邮箱 / 手机号）**、备用邮箱/手机、改密码、邮箱验证码设置密码
│   ├── bind/       绑定登录方式：出票 → 验证凭据 → 并入当前主体（微信授权 / 邮箱或手机号验证码）
│   ├── settings/   SCREEN 10 设置：账号个人设置 + 通用设置（智能引擎 / 消息中心开关 / 深色 / 语言 / 关于）
│   ├── messages/   SCREEN 11/11b 消息中心：分类筛选、一键已读、清空二次确认（墨黑底部动作条）
├── components/skeleton/        SCREEN 12 骨架屏：按记录流版面占位（记录页 loading 态）
│   └── privacy/    协议与隐私：用户协议 + 隐私政策全文（登录页底部链接进入）
├── custom-tab-bar/                     悬浮胶囊 Tab Bar（玻璃拟态；app.json 的 tabBar.custom=true）
├── components/login-panel/             单一登录入口组件（登录时自动检测账号状态 → 未注册则页内展开验证码注册；忘记密码；微信登录，仅登录页引用）
├── components/avatar-picker/           内置头像集底部弹层（12 款，纯样式无上传）
├── components/jump-loader/             简笔小人动画（纯 WXSS 绘制 + 关键帧，无外部素材；mood="jump" 加载跳动 / mood="sad" 异常跪倒落泪）
├── utils/
│   ├── cloud.js            云客户端（唯一实例，惰性初始化）
│   ├── store.js            数据层：entries / todos 读写封装
│   ├── profile.js          资料层：user_profile 读写、首次进入随机分配昵称（并发共享 promise + 唯一约束冲突兜底）
│   ├── avatars.js          内置头像集（12 款）、随机昵称、账号掩码
│   ├── wechat-auth.js      微信登录（wx.login → signInWithWechat）、账号类型判定、一次性提示
│   ├── identity.js         统一用户主体：标识归一化、主体归属解析、绑定票据、归属冲突判定
│   ├── llm.js              大模型接入：模型列表、流式对话、错误归类
│   ├── ai.js               本地规则引擎：分类/摘要/重点/待办/检索/关联/问答/总结
│   ├── ai-service.js       智能服务层：大模型优先，本地兜底
│   ├── text.js             中文分词、句子切分、关键词与信号抽取
│   ├── workbuddy-cloud-diagnostics.js   请求失败诊断
│   ├── workbuddy-data-access.js          单表 CRUD 封装
│   └── auth-guard.js                    登录跳转：来源记录、防重复入栈、返回目标页
├── miniprogram_npm/@tencent-ai/workbuddy-cloud-sdk/
│   └── miniprogram.js      已预置的小程序 npm 产物（170,205 B，CommonJS，9 项导出）
├── sql/                       统一用户主体的云端脚本（唯一事实源）：建表 / 解析函数 / 授权与 RLS / 业务策略
└── scripts/
    ├── selfcheck.js        引擎逻辑自测（32 项）
    ├── validate.js         工程结构与隐私清单校验（JSON / 页面 / tabBar / 组件 / 隐私 / 权限静态基线 / 待办交互 / 4 处 setData 绑定）
    ├── compile-check.js    官方编译器校验（wcc / wcsc + JS 语法 + SDK 产物，58 项）
    └── runtime-check.js    运行时链路模拟（mock 云 SDK + App 生命周期 + 微信登录 + 待办交互 + 统一用户主体 + 单一登录入口，92 项断言）
```

## 核心能力

| 能力 | 实现 |
|---|---|
| 自动分类 | 正文 → 类型（想法/资料/待办）+ 业务标签 + 类目；大模型优先 |
| 摘要 | 抽取式摘要：关键词覆盖度 + 位置权重 + 长度惩罚 |
| 重点提取 | 时间 / 金额 / 比例 / 数量 / 关键动作句 |
| 内容关联 | 关键词 Jaccard + 标签重合 + 同类目加权，Top 5 |
| 关键词检索 | 子串 + 分词 + 标签三层打分 |
| 智能问答 | 检索 Top 6 送入模型，要求标注依据来源；无结果时给建议 |
| 待办整理 | 抽取 → 去重合并 → 优先级排序 → 独立待办表 |
| 阶段总结 | 统计口径 + 内容分布 + 高频词 + 3–5 条可执行行动建议 |

## 本地验证

四条命令都不依赖微信开发者工具窗口，可随时复跑：

```bash
node scripts/selfcheck.js      # 32 / 32 通过：分词、分类、摘要、重点、待办、检索、关联、问答、统计
node scripts/validate.js       # 全部通过：24 个 JSON、10 个页面、tabBar、组件引用、隐私清单、权限静态基线、登录页 setData 绑定
node scripts/compile-check.js  # 58 / 58 通过：16 个 WXML 全量编译 + 16 个 WXSS 逐个编译 + JS 语法 + SDK 产物
node scripts/runtime-check.js  # 92 / 92 通过：大模型分支、system 消息、失败回落、字段映射、App 生命周期、微信登录、待办方框交互、统一用户主体、单一登录入口
```

`compile-check.js` 直接调用开发者工具自带的 `wcc.exe` / `wcsc.exe` 官方编译器（自动探测安装目录，可用 `WECHAT_DEVTOOLS_ROOT` 覆盖），产物写到系统临时目录，不污染工程。`wcsc` 多文件调用只处理第一个文件，因此脚本逐个编译。

实测结果：WXML 全量编译产物 199,019 B；14 个 WXSS 分别产出 448–约 4.8 KB（其中 `jump-loader.wxss` 含 `jump` / `sad` 两套共 11 组 `@keyframes`，rpx 由官方编译器正常处理）；23 个 JS 全部通过 `node --check`；SDK 产物 9 项导出中 `createMiniProgramWorkBuddyCloud` 为 function；`cloud.js` 惰性加载不报错。

`runtime-check.js` 用 mock 云 SDK 替换 `utils/cloud.js`，验证了：模型列表返回数组时能跳过推理模型选中 `hunyuan-chat`、三次对话首条均为 system、结构化请求带 `response_format`、模型失败时三条链路都回落本地、驼峰与下划线字段往返无损；并**真实加载 `app.js` 跑 `onLaunch` / `onShow`**，自动扫描源码里全部 `cloud.auth.<name>` 调用断言 mock 覆盖（当前 8 个），另验证 SDK 缺 `handleWorkBuddyMiniProgramCallback` 时生命周期不崩、未登录时 `ensureSession()` 返回 `null`。

## UI 改版：墨黑杂志风 v1.0（2026-11-06 15:07）

按冻结方案 `ui-design-proposal.html`（工作区根，v1.3 静态稿）落地到小程序代码，方案不返工。

| 项 | 落地 |
|---|---|
| 色板 | 纸底 `#F7F5F0` / 墨 `#1A1A1A` / 次墨 `#6B6862` / 细线 `#E3DFD8` / 朱红 `#D6452B` / 纸白 `#FFFEFA`；全工程旧蓝 `#2f6bff`、灰底 `#f4f6fa` 已清零 |
| 去卡片 | `app.wxss` 的 `.card` 改透明 + 1px 细线分组；所有页面 WXSS 去掉圆角与投影 |
| 刊头 | 4 主屏统一 80rpx 衬线大标题 + 朱红 eyebrow + 2px 墨线 + 日期/计数 meta |
| 时间轴 | 记录页按 `createdAt` 日期分组（今天 / 昨天 / M月D日），左侧 1px 竖线 + 类型色方块节点；`pages/index/index.js` 新增 `groupByDay()` / `countToday()`，Node 实测 4 条记录分成 3 组、今日计数 2 |
| Tab Bar | 微信原生 tabBar 不支持悬浮胶囊，改 `app.json` 的 `tabBar.custom=true` + 新增 `custom-tab-bar/` 组件（124rpx 高 / 72rpx 圆角，激活墨底 + 朱红圆点）；**5 个 tab 页**（记录 / 检索 / 待办 / 总结 / 我的）`onShow` 用 `getTabBar().setData({selected})` 兜底高亮 |
| 组件 | 按钮直角朱红、标签直角细线、输入区纸白直角、勾选框方角墨底、空状态虚线框；类型标记改 18rpx 实心方块 |
| 二级页 | detail / profile / login 同步去卡片、衬线文档标题、朱红重点；保留原生导航栏，不加自定义返回行（避免与系统返回重复、不改路由） |

**改动文件**：`app.wxss` / `app.json`、4 主屏 WXML+WXSS+JS、3 二级页 WXSS、`components/login-panel/login-panel.wxss`、新增 `custom-tab-bar/` 4 文件，共 23 个。改版前全量备份在 `.workbuddy/backup/ui-before-20261106/`（25 文件，122 KB，工程外，不进包体）。

**IDE 验证**（未登录态截图，存 `.ide-shots/ui-v1/` 共 5 张）：4 主屏刊头、朱红 eyebrow、墨线、悬浮胶囊 Tab Bar 全部正确；Tab 激活态 4 页各自正确；登录页纸白直角输入 + 朱红主按钮；无蓝色或白卡片残留。首次截图发现「切到检索页仍高亮记录」，原因是自定义组件 `pageLifetimes.show` 在 IDE 里不触发，已在 4 页 `onShow` 加兜底并复截验证通过。

**未实现项**：① 深色模式（静态稿第 04 节有 6 个暗色 token，但模式切换属新增功能，不在本次拍板范围）；② Tab 项 SVG 图标（WXML 不支持 inline SVG，改为纯文字 + 朱红圆点）；③ 静态稿的状态屏/骨架屏（工程已有 `jump-loader` 加载组件承担）。中文衬线字体依赖系统：iOS 用 Songti SC，Android 无衬线中文字体时会 fallback，刊头字形可能与设计稿有差异。

## 本轮修复

| 问题 | 处理 |
|---|---|
| `miniprogram_npm` 缺失，运行时 `require` 云 SDK 会失败 | 预置 SDK 的 `miniprogram_dist` 产物 + CommonJS 兼容 `package.json`；`packOptions` 排除 `node_modules` 但保留 `miniprogram_npm` |
| `models.list()` 官方返回数组，代码误取 `result.data`，导致模型列表恒为空、大模型永不启用 | `llm.js` 改为兼容数组与 `{data:[...]}` 两种形态 |
| 编译产物和脚本会被打进包体 | `project.config.json` 的 `packOptions.ignore` 增加 `node_modules` / `scripts` / `.buildcheck` |

## 云端数据模型

`entries`（记录）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | BIGINT IDENTITY | 主键 |
| `owner_id` | TEXT DEFAULT auth.uid() | 归属，服务端填充，前端不发送 |
| `owner_name` | TEXT | 昵称快照，仅展示 |
| `type` | TEXT | idea / material / todo |
| `title` `content` | TEXT | 标题与原文 |
| `category` | TEXT | 业务类目 |
| `tags` `keywords` | TEXT[] | 标签与关键词 |
| `summary` | TEXT | 摘要 |
| `key_points` | TEXT[] | 重点信息 |
| `todo_items` | JSONB | 抽取出的待办项 |
| `related_ids` | BIGINT[] | 关联条目 |
| `created_at` `updated_at` | TIMESTAMPTZ | 时间戳 |

`todos`（待办）：`title` / `priority`(high·normal·low) / `due_text` / `status`(open·done) / `source_entry_id` / `sort_order`。

RLS：两张表均为「仅本人读写」，共 8 条策略（每表 SELECT / INSERT / UPDATE / DELETE）；SELECT/UPDATE/DELETE 用 `USING (owner_id = auth.uid())`，INSERT 用 `WITH CHECK (owner_id = auth.uid())`。

## 模型与积分

选模顺序见 `utils/llm.js` 的 `PREFERRED_MODEL_IDS`：优先 `hunyuan-chat`（普通对话模型，无 `onlyReasoning` 标记），依次回退 `deepseek-v4.1-flash` / `glm-4.7` / `default`；列表首个 `auto` 是推理模型，不作为结构化 JSON 输出的首选。

| 模型 | 目录标注积分倍率 | 用途 |
|---|---|---|
| `hunyuan-chat` | 目录未标注 | 当前首选，普通对话 |
| `hy3` | x0.00 | 推理模型，不选 |
| `deepseek-v4.1-flash` | x0.11 | 回退候选 |
| `glm-4.7` | x0.23 | 回退候选 |
| `default` | x2.20 | 最后回退 |

倍率取自云模型目录实时查询，仅用于选型参考，不是可用额度。额度不足时 `llm.js` 会把 `quota_` 类错误转成「模型额度不足」，并回落本地规则引擎。

## 真机编译验证（IDE 内已完成）

用户在微信开发者工具里打开「服务端口」并授权 `CodeBuddy` CLI 后，门禁检查通过：`loginExpired=false`、`tokenRequired=false`、`versionRelation=equal`（IDE 内置 skill 0.3.11 已同步到 `~/.workbuddy/references/wechatide-skill/`）。

| 验证项 | 实测结果 |
|---|---|
| 项目窗口 | `open_project_window` 成功，`winId: s0` |
| IDE 内部 WXML 编译 | 7 个全部成功（`compile_wxml`，产物 32,400 字符） |
| IDE 内部 WXSS 编译 | 8 个全部成功（`compile_wxss`） |
| 模拟器编译与页面 | `simulator_refresh` 成功；6 个页面逐个 `simulator_open_page` 全部成功 |
| 运行时上下文 | `currentPage = pages/index/index`，标题「记录」 |
| 界面截图 | 首页 / 待办 / 总结 / 检索 4 张，登录引导、输入框、按钮、tabBar 高亮均正常，无白屏无报错 |

当时的 4 张界面截图已按用户要求清理，归档备份在工作区 `.workbuddy/backup/ide-shots-20261106/`；当前 `.ide-shots/` 只保留最新一张真机预览二维码。关键旁证：`app.js` 顶层就 `require('./utils/cloud')`，首页能正常渲染说明**预置的 `miniprogram_npm` 在真实 IDE 里解析成功**，云 SDK 加载链路通。

### 真机测试故障：域名白名单（已配置，真机复验通过）

首次扫码登录报 `request:fail url not in domain list`。官方诊断文档判定为域名拒绝：`stage=network`、`status=0`、无服务端 request ID。

> **结论（2026-11-06 11:29）：用户反馈「已测试可靠」，真机复验通过，域名白名单问题已闭环；11:33 补充 4 张截图逐项留证，详见下一节。** 以下保留完整排查过程备查，不是待办事项。

- **根因**：`project.config.json` 的 `setting.urlCheck: true`（模板默认），真机预览强制校验 request 合法域名；接口测试号未登记白名单。
- **已验证无效的尝试**：把 `setting.urlCheck` 改为 `false`（含 IDE 自动生成的 `project.private.config.json`）并重新出码，真机**仍报同一错误**。微信规则：开发者工具的「不校验合法域名」**只对模拟器生效**，真机预览 / 体验版 / 正式版一律读公众平台保存的域名列表。该开关保留仅供模拟器调试，**不是真机解法**。
- **唯一正解（真机与正式发布通用）**：在当前绑定 AppID 对应的小程序 mp 后台（管理 → 开发管理 → 开发设置 → 服务器域名，需管理员扫码授权）把 `https://mp-api.app.workbuddy.host` 加入 **request 合法域名**；若用到文件上传/下载，同样加进 uploadFile / downloadFile 白名单。换 AppID 不会自动继承白名单，每个 AppID 都要单独配。
- 配置生效后：`debug_clear_cache --action cleanCompileCache` → 关/开项目窗口重读配置 → `simulator_refresh` → 重新出预览码 → 手机重扫。域名列表同步可能有几分钟延迟，重扫前建议在微信里删掉旧的小程序预览记录。
- **2026-11-06 11:10 已配置完成**：用户在新 AppID 的 mp 后台把 `https://mp-api.app.workbuddy.host` 登记为 request 合法域名，后台页面显示「本月还可修改 49 次」「可配置数量 300 个」。**更正**：此前文档写的「一个月最多修改 5 次」是旧规则，本账号实际额度以后台页面显示为准。
- 网关连通性复核（配置后）：本机 `curl` 到网关根路径返回 `http_code=404`（根路径无路由，属正常），说明 TLS 建连与 HTTP 响应正常；`remote_ip=127.0.0.1` 是本机 HTTP 代理，不代表域名不可达。
- 网关 DNS 已核实：`mp-api.app.workbuddy.host` → 腾讯云 CLB（CNAME `lb-*.clb.bj-tencentclb.cloud`，公网 IP 正常），域名本身可用，问题纯粹在白名单。
- 官方文档明确禁止用「改 `publicConfig.endpoint`」或「手写 `wx.request`」绕过：小程序只能访问白名单内的 host，正解是把固定网关登记进去。走 WorkBuddy 应用卡 Share 发布的托管小程序，需确认平台侧已登记该域名。

### 真机逐项验证（2026-11-06 11:33，改版前 4 张截图留证）

用户补充 4 张真机截图（记录 / 检索 / 待办 / 总结），此前保留的「验证边界」至此闭环。截图归档在工作区 `.workbuddy/backup/real-device-20261106/`：**本地，未上云**，不在工程目录、不进包体。

| 页面 | 截图可见 | 结论 |
|---|---|---|
| 记录 | 3 条记录、自动分类标签（想法 / 资料 / 待办）、自动抽取的业务标签、时间戳、类型筛选、tabBar 高亮正常 | 云端 `entries` 写入与读取通 |
| 检索 | 关键词命中高亮；智能问答标注「回答（大模型）」，三段式结论 + 【记录1】依据 + 信息缺口 | 云端 LLM 实际调用成功 |
| 待办 | 0 待处理 / 1 已完成，勾选项已持久化，带「来自记录」关联跳转 | 云端 `todos` 写入与状态更新通 |
| 总结 | 近 7 / 30 / 90 天切换、标注「大模型生成」、3 总记录 / 1 未收口 / 0 已完成、内容分布、高频关键词、3 条行动建议 | 统计 + LLM 阶段总结链路通 |

**两条硬证据，不是从截图外推**：

- `utils/store.js` 用 `createTableAccess(cloud, ...)` 直连云端两张表，全工程没有 `wx.setStorageSync` 业务缓存（只有诊断模块对 wx API 的透传包装）；4 页数据一致（3 条记录、1 条已完成待办）说明是云端读写，不是本地缓存。
- 页面 WXML 只在 `engine === 'llm'` 时显示「大模型生成」/「回答（大模型）」，否则显示「本地统计」/「回答（本地检索）」；`utils/ai-service.js` 仅在 `llm.complete()` 成功且解析出结果时返回 `engine: 'llm'`，任何失败都回落 `'local'`。两处截图均为「大模型」，可确认云端模型调用成功、不是本地回落。

- 账号密码登录由用户本人操作；注册与找回密码的邮箱验证码需本人收码，agent 未代替操作。
- `get_simulator_console` 读取失败：IDE 自身把带空格的 `C:\Program Files\...` 路径传给命令时没加引号，报 `'C:\Program' is not recognized`，属于工具侧环境问题，不是工程代码报错。
- **AppID 当前绑定**为用户新注册的小程序（`project.config.json` 的 `appid`；`get_user_appids --type miniprogram` 能查到该号，但 `appName` 为空，说明后台尚未设置名称，可在 mp 后台改名）。此前依次用过模板基线 `touristappid`（真实 IDE 报「不存在此 AppID」）、临时借用的接口测试号、以及账号下原有的「好玩的梦幻的小商店」；旧号均已停用，旧 AppID 未在微信侧注销（注销需管理员本人走公众平台官方流程）。回退基线备份在工作区 `.workbuddy/backup/ide-shots-20261106/`（工程外，不打包）。
- 换 AppID **不改变**云端资源：`entries` / `todos`、RLS、模型配置都挂在 WorkBuddy 云服务的应用 ID 下，与小程序 AppID 无关；也**不继承**域名白名单；新号已于 2026-11-06 在自己的 mp 后台单独登记该域名（见上一节）。

## 账号体系与隐私（2026-11-07）

### 登录方式

| 场景 | 实现 | SDK 方法 |
|---|---|---|
| 登录 | 账号（邮箱或手机号）+ 密码 | `signInWithPassword({ email｜phone, password })` |
| 注册 | 账号 + 密码 + 一次验证码（provider 硬性要求验码后才允许设密码） | `sendOtp` → `verifyOtp({ token, password })` → 内部 `signUp` |
| 忘记密码 / 首次设置密码 | 邮箱验证码 + 新密码（登录页「忘记密码」，或「我的 → 账号与安全」页内完成） | `resetPasswordForEmail` → `updateUser({ nonce, password })` |
| 登录态改密码 | 原密码 + 新密码 | `resetPasswordForOld({ oldPassword, newPassword })` |
| 微信登录 | 登录页「微信登录」按钮 → `wx.login` 取 code → 运行时取 `appid` | `signInWithWechat(code, appid)` |
| 绑定其它登录方式 | 「我的 → 账号与安全 → 登录方式」：微信授权，或邮箱 / 手机号验证码 | `signInWithWechat` / `sendOtp` → `verifyOtp`，再用绑定票据把新身份并入当前主体 |

**微信登录规则与边界**（按官方 cloud-service / auth / code-generation.md）：
- `appid` 运行时从 `wx.getAccountInfoSync().miniProgram.appId` 取；**不硬编码、不用 `wbapp_…` 代替**；`touristappid`（游客态）直接拒绝并给友好提示。
- 不实现 `jscode2session`、不收 AppSecret、**不把 openid 存成自己的认证凭据**；日志只记 `stage` / `message`，不记 code、session、原始 error。
- `wx.login` 失败 / 无 code / SDK 报错 → 统一返回中性提示，不抛异常、不白屏；按钮有 `wechatLoggingIn` 防重复点击；**同样受协议勾选门禁约束**。
- H5 预览拿不到真实 code，**必须在微信内验证**。
- **setup gap（非代码问题）**：需在 WorkBuddy Auth 管理页开启微信登录 Provider，并完成小程序应用绑定。当前会话没有该管理能力，未声称开关已启用；若真机点微信登录报 provider 未启用，属此项。
- **微信登录默认是独立账号**（SDK 无合并接口），但现在可以主动绑定：绑定后微信与邮箱/手机号属于同一用户主体、共用一份数据，见下节「统一用户账号体系」。首次微信登录弹一次说明，「我的」「账号与安全」显示账号类型；微信账号隐藏「修改密码 / 邮箱找回密码」（无原密码、无邮箱），避免点了必报错。

**账号形态的硬约束**：云端账号标识在注册时必须是 `email` 或 `phone` 恰好其一（`signUp` 校验），不能纯用户名注册。因此注册页仍会填一个「账号」，只是**不再单独收联系方式**；邮箱/手机作为可补充的备用联系信息放在「我的 → 账号与安全」。

### 统一用户账号体系：主体 + 多登录凭据（2026-11-07 15:00）

**要解决的问题**：云端 auth 的 uid（JWT `sub`）由登录方式决定 —— 邮箱登录一个 uid、手机号登录一个 uid、微信登录又是一个 uid。SDK 没有「给已有账号追加标识」也没有「合并账号」的接口（`updateUser` 只接受 `{nonce, password}`），不改这一层，同一个人用三种方式登录就是三个互不相通的账号。

**采用的模型**（不动 SDK，只在应用层加一层归属）：

| 表 | 作用 | 关键约束 |
|---|---|---|
| `user_link` | `uid → subject_id` 的归属关系，一个主体可挂多个 uid | `uid` 主键；改 `subject_id` 必须持有效票据 |
| `user_credential` | `(provider, identifier) → subject_id + uid`，记录微信 / 邮箱 / 手机号三种凭据 | **主键 `(provider, identifier)` → 同一登录标识只能属于一个主体** |
| `user_bind_ticket` | 绑定授权票据：证明「把某个 uid 并入某主体」是主体本人授权 | `gen_random_uuid()` 生成、10 分钟有效、一次性（`used_at`） |

三个解析函数（`SECURITY DEFINER` + `STABLE`，内部查 `user_link` 时绕过该表自身 RLS，避免策略递归）：

- `current_subject_id()` → 当前会话 uid 所属主体；没有归属行时主体就是 uid 自己（存量数据零迁移）
- `current_subject_scope()` → 本主体下**所有** uid 的数组
- `verify_bind_ticket(ticket, subject)` → 票据是否属于该主体、未过期、未使用

**业务数据不搬、只换判定口径**：`entries` / `todos` / `user_profile` 的 `owner_id` 仍存原始 uid，新建行的 `DEFAULT` 改成 `current_subject_id()`；12 条业务策略从 `owner_id = auth.uid()` 改成 `owner_id = any(current_subject_scope())`。合并前后创建的数据都落在同一主体的可见范围里，所以「合并」不需要搬数据，也就不存在搬一半失败的中间态。

**绑定流程**（`pages/bind/bind`）：

1. 在当前主体**出票**（`user_bind_ticket`，10 分钟有效）；
2. 验证新凭据 —— 微信走 `wx.login` + `signInWithWechat`，邮箱 / 手机号走 `sendOtp` + `verifyOtp`（这一步 SDK 会把会话换成该标识对应的 uid）；
3. 用票据把新 uid **并入**原主体（`user_link` 的 INSERT / UPDATE 策略在数据库层校验 `verify_bind_ticket`）；
4. 把该 uid 名下的凭据行挂到新主体（`user_credential` UPDATE），使「已绑定」列表不丢行；
5. 票据置 `used_at` 作废。

第 2 步之后会话已经换成新 uid，若第 3 步失败：原账号数据**完全没动**，页面保留票据并提供「重试绑定」，不会把两张票混用。

**归属冲突的处理**（要求里点名的那一条）：`user_credential` 的主键就是冲突闸门 —— 同一 `(provider, identifier)` 只能有一行，插入撞主键（云端返回 `23505` / 409）即判定为「该标识已归属于另一个主体」，返回 `IDENTIFIER_ALREADY_BOUND`，**不自动改归属、不合并数据**。三处体现：

- 登录时：仍按当前会话正常进入，但弹窗说明「该登录方式已在别的账号下，本次是独立账号」，引导去「账号与安全」处理；
- 绑定时：**先切会话、再看这个标识原本属于谁**（`identity.subjectOf()` 读自己的归属行）。若原本属于另一个主体 → 弹出「归属冲突」卡片，由用户显式点「合并到当前账号」才继续；不点就保持两边独立，不动任何数据；
- 凭据登记撞主键时：直接拦下并提示，不写入；
- 底层：`user_link` 的 UPDATE 策略要求 `subject_id = uid` 或 `verify_bind_ticket(ticket_id, subject_id)`，没有票据改不了归属；`user_credential` 的 INSERT 要求 `subject_id = current_subject_id() AND uid = auth.uid()`，不能替别人登记凭据。

**前端模块**：`utils/identity.js` —— 标识归一化（邮箱转小写去空格、手机号去空格与连字符、微信原样）、主体解析、凭据登记、票据签发与消费、冲突判定。登录成功后 `login-panel` 做一次**补账**（`claimAfterLogin`），补账失败只影响补账，不影响登录本身。

**云端脚本**：`sql/01_identity_tables.sql` → `02_subject_functions.sql` → `03_grants_rls.sql` → `04_business_policies.sql`，按顺序执行即为当前线上状态（唯一事实源）。

**边界与风险（如实记录）**：

- `exec_sql` 的 read / migrate 角色都是 `rolbypassrls=true`，**无法用 SQL 直接验证策略生效**。策略口径改由 `scripts/runtime-check.js` 第 10 节的内存版 RLS 复刻验证（可见性、票据校验、唯一键冲突、更新前后主体验算，全部按 SQL 原文实现）。
- 票据对**本主体成员**开放签发，成员可把 10 分钟内的一次性票据给外人用于并入主体；这是「邀请码」语义，被冒用时对方只能并入**已获授权**的主体，窗口受 TTL 与一次性限制。要更严可把票据签发收紧到「主体本人（uid = subject_id）」。
- 合并只并**被验证的那个 uid**，不自动搬运同一旧主体下其它 uid；要全部并入需逐个绑定。
- `user_profile.owner_id` 上有唯一索引，合并后主体下可能存在两行资料（各属一个 uid）；`ensureProfile()` 复用先读到的那行，不会重复建号。
- `anon` 角色对三张身份表已全部 `REVOKE`。

**回归**：`scripts/runtime-check.js` 第 10 节 28 条断言 —— 标识归一化 4 + 唯一键冲突识别 3 + 主体归属 2 + 凭据登记 2 + 归属冲突 3 + 票据并主体 4 + 凭据行跟随 1 + `subjectOf` 3 + 无票据 / 过期 / 已用票据拒绝 6；断言总数 48 → **76**。

**线上复核（2026-11-07 15:35，本轮用云端只读查询逐项核对，非凭记忆）**：

| 项 | 线上实测 |
|---|---|
| 表与 RLS | 6 张表全部 RLS 开启：`entries` / `todos` / `user_profile` / `user_link` / `user_credential` / `user_bind_ticket` |
| 解析函数 | `current_subject_id() → text`、`current_subject_scope() → text[]`、`verify_bind_ticket(text,text) → boolean`，三者 `SECURITY DEFINER=true`、`STABLE` |
| 唯一索引 | `user_credential_pkey (provider, identifier)` ← **同一登录标识只能属于一个主体**的硬闸门；`user_link_pkey (uid)`；`user_profile_owner_id_key (owner_id)` |
| `owner_id` 默认值 | `entries` / `todos` / `user_profile` 三表均为 `current_subject_id()`（不再是 `auth.uid()`），存量行零迁移 |
| 策略口径 | 业务表 12 条策略全部 `owner_id = ANY(current_subject_scope())`；身份表 11 条：`user_link` 的 UPDATE 带 `WITH CHECK` 票据校验（无票改不了归属）、`user_credential` 的 INSERT 要求 `subject_id = current_subject_id() AND uid = auth.uid()` |

### 权限与健壮性基线（2026-11-07 审查后修复）

| 项 | 处理 |
|---|---|
| 匿名角色权限 | 云端执行 `REVOKE ALL ON TABLE entries, todos, user_profile FROM anon`，`anon` 已无任何业务表权限；孤儿行 `owner_id='anon'` 不删除、自然隔离 |
| 资料唯一性 | `CREATE UNIQUE INDEX user_profile_owner_id_key ON user_profile(owner_id)`；`ensureProfile()` 建号失败时重读已有行，避免并发撞唯一约束报错 |
| 会话门禁 | 7 个数据页全部 `ensureSession()`；补上原先唯一遗漏的 `pages/detail/detail.js` |
| 会话缓存 | `app.js` 注册 `onAuthStateChange`，`SIGNED_OUT` / `SIGNED_IN` / `PASSWORD_RECOVERY` / `USER_UPDATED` / `TOKEN_REFRESHED` 时清 `sessionPromise` |
| 静态回归 | `scripts/validate.js` 新增：7 个数据页门禁检查、前端不得写 `owner_id` / 不得按 `owner_id` 过滤、表名与 `cloud.auth.*` 方法白名单、密钥形态扫描 |
| 运行时回归 | `scripts/runtime-check.js` mock 扩到 10 个 auth 方法；新增微信登录成功/失败/游客态/账号类型/提示一次性共 7 条断言；App 生命周期缺方法不崩仍覆盖；统一用户主体 25 条（见上节） |

云端 RLS 仍是服务端配置（业务表 12 条策略 + 身份表 11 条策略，共 6 表 RLS 开启），**本地脚本不覆盖策略内容**，策略口径由 `runtime-check.js` 第 10 节的内存复刻间接覆盖；发布前须按真机清单核对。

### 待办完成状态交互（2026-11-07 11:11）

| 规则 | 实现 |
|---|---|
| 只有点左侧方框才切换完成状态 | `onToggle` 从 `.todo-main`（整行）移到 `.todo-check-hit`（方框热区），用 `catchtap` 阻止冒泡 |
| 点条目文本 / 内容区 / 整行 / 空白区 | `.todo-main`、`.todo-body`、`.todo-title` 均**无任何 tap 绑定** → 不改变状态 |
| 方框与条目点击互不干扰 | `catchtap` 隔离；删除 `todo-del`、来源 `todo-source`、`已完成` 折叠头 `done-head` 各自独立绑定，行为不变 |
| 连续点击 | `onToggle` 用实例锁 `this.toggling`（不进 `data`，避免渲染无关的 setData），请求期间重复点击直接忽略，`finally` 释放 |
| 已完成条目 | 点其方框可取消完成（`done → open`），保持原有双向切换语义 |
| 视觉不变 | `.todo-check-hit` 用 padding 扩大热区到约 72×84rpx，负 margin 抵消，方框位置、间距、列表版式与之前一致 |

**回归防护**：`scripts/validate.js` 静态断言「2 个 `todo-main` 均无 tap、2 个 `todo-check-hit` 均有 `catchtap="onToggle"`、删除/来源入口保留」；`scripts/runtime-check.js` 加载真实 todo 页配置做行为断言：连续点击只发 1 次 `todos.update`、未完成→done、已完成→open、锁释放后可再次点击。

### 「我的」页版面（2026-11-07 11:24，按设计稿 SCREEN 06）

依据工作区 `ui-design-proposal.html` 第 595–634 行（SCREEN 06）与第 184–212 行 CSS，px 按 2× 换算 rpx，色值沿用全局 token（`#F7F5F0` / `#1A1A1A` / `#6B6862` / `#E3DFD8` / `#D6452B` / `#FFFEFA`）。

| 设计稿区块 | 落地实现 |
|---|---|
| `masthead` eyebrow / h1 / meta | 复用全局 `.masthead*`，文案 `ACCOUNT / 个人空间` · `我的` · `云端专属空间 / 仅本人可见` |
| `identity` | 方形色底单字头像（92rpx、衬线 40rpx、2rpx 细线）+ 衬线昵称 + `编辑` 链接 + 副文案（含「点击头像可更换」）；下 4rpx 墨线 |
| `statbig` | 104rpx 主数字「条记录」+ 右侧朱红「未完成 N」；下 1px 细线 |
| `statmini` | 4 等分格（想法/资料/待办/未完成），左细线分隔；未完成朱红 |
| `sec-label` × 4 | `我的数据 / OVERVIEW`、`账号与安全 / ACCOUNT & SECURITY`、`隐私协议 / PRIVACY`、`智能引擎 / ENGINE`，朱红小字 + 字距 |
| `settingrow` | 账号与安全 5 行、隐私协议 2 行、智能引擎 1 行；细线分组，无白卡片 |
| `signout` | 文字式居中退出登录，上下细线（原 `btn-danger` 按钮改为设计稿样式） |

**功能保留**：头像点击换头像、昵称编辑、账号与安全跳转、退出登录、头像选择器、`modelHint` 与 `isWechat` 分支文案全部保留；**新增**「我的」页的《用户协议》《隐私政策》两个入口（`onOpenTerms` / `onOpenPrivacy` → `pages/privacy/privacy?doc=terms|privacy`）。头像由圆形改方形后，`components/avatar-picker` 同步改为方形，避免选择器与展示不一致。

**核验**：设计稿 SCREEN 06 的 30 项元素逐项对照，30/30 已落地；四套校验全过（含官方 wcc/wcsc 编译）、事件绑定 9 个 handler 全部有对应方法。登录态页面无法在 IDE 未登录态截图，版面需真机扫码确认。

### 登录页同步设计稿 SCREEN 07 / 07c（2026-11-09）

**依据**：`screen07-login.html`（14:04）+ `screen07-shot.png`（14:05，渲染截图）+ `ui-design-proposal.html` 第 744–812 行 SCREEN 07 / 07c（14:07）。两份稿有出入时以**截图**为准：截图里主按钮 112px 靠右、且有「提交反馈」框；主稿 HTML 里主按钮全宽、无反馈框。

| 设计稿元素 | 落地 |
|---|---|
| `masthead` eyebrow / h1 / meta | 复用 `app.wxss` 全局 `.masthead*`（80rpx 衬线标题 + 4rpx 墨线），文案 `SIGN IN / 个人空间` · `登录` · `账号密码登录 / 仅本人可见` |
| `subnav`（`‹ 返回` + `登录`） | **未加**：小程序原生导航栏已提供返回与标题，再画一条会出现双导航栏。如需细线返回行，单独说 |
| `authlabel` / `authfield` | 字段加 `账号 / ACCOUNT`、`密码 / PASSWORD`、`确认密码 / CONFIRM`、`邮箱验证码 / CODE`、`新密码 / NEW PASSWORD`；placeholder 改 `手机号或邮箱` / `请输入密码`；输入框 96rpx 纸白直角不变 |
| `loginbtn` | 主按钮 `224rpx` **居中**（15:30 本人拍板改回居中版式）；三种模式统一 |
| `feedback` 提交反馈框 | **已删除**（14:50 本人要求「把固定页面的提交反馈删除」）。WXML 块、WXSS 样式、`login-panel.js` 的 `feedback` 状态与全部 `setData` 一并清掉，不留死变量 |
| `忘记密码？` / `返回登录 ›` | 左对齐，下划线保留 |
| `wechat-divider` + `wechat-btn` | 改 flex 双细线 + 居中「或」；按钮改 `1rpx solid #1A1A1A` 描边 |
| 协议勾选 | 默认未勾；勾选框改 2rpx 墨线 + 墨底勾 |
| `authfoot` 页脚 | **已删除**（15:30 本人要求）；底部只留空白 |
| 07c 字段标签 | forgot / signup 模式同步上述 label 体系与 224rpx 主按钮 |

**顺手修的低级 BUG**：`pages/login/login.js` 原来把 `from` 放进 `data` 并 `setData`，但 WXML 从未绑定 → 就是之前 IDE 报的「存在将未绑定在 WXML 的变量传入 setData」。改为实例属性 `this.from`。`scripts/validate.js` 新增静态断言，扫描登录页与登录组件里 `setData` 的顶层 key，逐个要求在对应 WXML 有绑定（当前 3 + 14 个全部通过）。

**两处与设计稿不一致的地方，已由本人拍板**：
1. **注册入口 → 拍板「收成单一入口 + 页内展开」**。设计稿写「提交时自动检测账号状态，无账号则直接注册并登录」；SDK 硬性要求 `sendOtp` → `verifyOtp` 验码后才允许 `signUp` 设密码，做不到无验证码自动建号。落地为：**去掉登录/注册 tab**，默认单一入口；提交 `signInWithPassword` 失败且错误明确是「账号不存在」时，自动 `sendOtp` 并页内展开「确认密码 + 验证码」区，验码后 `verifyOtp` 建号并登录；另有「没有账号？注册」手动入口兜底。`sendOtp` 返回 `isExistingUser=true` 时收起注册区并提示已注册。密码打错**不会**误发验证码（只有明确 `not-found` / 账号不存在才自动展开）。
2. **微信 hint 文案 → 拍板「保持事实修正文案」**。设计稿原句「微信登录创建的账号，与邮箱 / 手机号账号数据互通」与已上线的统一账号体系矛盾；最终保留「微信登录是独立账号；在『账号与安全』绑定邮箱 / 手机号后，两种方式共用一份数据」。

注册自动展开时的说明改由**既有的 `login-tip`** 承载（不新增视觉块）：「该账号未注册，验证码已发送，填完即可创建并登录」。

**回归**：`scripts/runtime-check.js` 新增第 11 节 16 条断言，直接加载真实 `login-panel` 配置跑状态机 —— 已注册直接登录（0 次验证码）、账号不存在自动展开（1 次验证码、不触发 signedin）、密码错不误发码、手动入口可展开、`isExistingUser=true` 时收起、两次密码不一致拒绝、填全后 `verifyOtp` 建号登录、协议门禁仍生效。断言总数 76 → **92**。`compile-check.js` 的官方 wcc / wcsc 已全量编译 15 个 WXML 通过。

**15:30 三处删除/回退（本人指令）**：
1. 删 `components/login-panel/login-panel.wxml` 的 `.wechat-hint`（「微信登录是独立账号；在『账号与安全』绑定邮箱 / 手机号后，两种方式共用一份数据」）及 WXSS 样式。
2. 删 `pages/login/login.wxml` 的 `.authfoot`（「数据保存在你的专属云端空间，仅本人可见。登录成功后返回原本的页面。」）及 WXSS 样式。
3. 「登录」按钮改回**居中**：删 WXML 的 `.login-button-wrap` 包裹、删 WXSS 的 wrap 规则，`.login-button` 改 `width:224rpx !important; margin:44rpx auto 0 !important`（保留 `!important` 只为压过 button 内置规则，方向由 auto margin 决定居中）。

**核验**：`simulator_open_page` 重编译 → `simulator_screenshot` 重截 → 像素实测居中（119/118）、`ViewImage` 目视确认两处文案均已消失、版面无重叠。最终截图 `.ide-shots/screen07-live-final-20261109.jpg`（336×726，**25,465 B**，15:32 覆盖）。四套校验全过（validate ✓ / compile-check 54 / runtime-check 92 / selfcheck 32）。

> 注：`pages/privacy/privacy.wxml` 与 `pages/profile`、`pages/settings` 里仍有「数据保存在你的专属云端空间」「微信登录是独立账号…数据不互通」等相似文案 —— 本次指令只针对登录页，未动其它页面；其中隐私协议那句与已上线的统一账号体系矛盾，列入待办候选。

**14:50 追加**：本人要求「登录页，把固定页面的提交反馈删除」。已删 `login-panel.wxml` 的 `.feedback` 块、`login-panel.wxss` 的 6 条 `.feedback*` 样式、`login-panel.js` 的 `feedback` data 字段与全部 13 处 `setData` 引用；`expandSignup(auto)` 的 `auto` 形参随之收掉。注册展开时的说明改由既有 `login-tip` 承载。`runtime-check.js` 第 11 节对应断言改查 `tip`，仍 92/92；`validate.js` 的 setData 绑定检查从 15 个 key 降到 13 个，全部有绑定，无死变量。

**15:20 真机截图核验 + PATH**：`wechatide` CLI 已验通（clientName `WorkBuddy`、首次 client 授权已在开发者工具确认、`check_wechatide_status` 返回 `versionRelation=equal` / `loginExpired=false` / `cliTokenRequired=false`）。`ensure-cli-path.mjs --check` 返回 `needs_link`，但实测**用户级 PATH 本来已含安装目录**（`USER_PATH_HAS_INSTALL:1`），只是当前进程未继承；把目录临时加进进程 PATH 后 `where wechatide` 立即命中，新开终端即可直接 `wechatide -c ...`，无需改系统。

**真机截图**：`.ide-shots/screen07-live-final-20261109.jpg`（336×726，25,465 B，15:32 最终版）。核验到位：`SIGN IN / 个人空间` 刊头 + 80rpx 衬线「登录」+ meta、按来源引导小字、字段 label 与 placeholder、忘记密码 / 没有账号？注册、「或」分隔线 + 描边微信登录 + hint、方形未勾协议框；**提交反馈框、微信说明、页脚均已删除** ✓。

**主按钮位置（15:28 → 15:30 最终改回居中）**：微信小程序 `<button>` 内置 `margin-left/right:auto` 且优先级高于普通 class，flex 下 auto margins 会盖掉 `justify-content`，`width` 也被压 —— 这是最初一直「居中」的根因（不是 IDE 缓存，重启项目窗口后按比例缩放仍居中已证伪缓存判断）。15:28 曾用 `!important` 提权做到靠右（x=216→314）；**15:30 本人拍板「还是按以前的版式：居中」**，已撤销 `.login-button-wrap` 与靠右提权，改为 `width:224rpx !important; margin:44rpx auto 0 !important`。**最终像素实测 x=119→217（宽 99px），左右边距 119/118 → 居中** ✓。

### 已核实的 SDK 能力边界

| 能力 | 状态 |
|---|---|
| 密码登录、带密码的验证注册、邮箱找回密码、登录态改密码 | ✅ 支持，已落地 |
| 微信登录（小程序 `wx.login` → `signInWithWechat`） | ✅ 支持，已落地；Provider 开关需管理页启用 |
| 手机号找回密码 | ❌ 官方文档明确：Phone password recovery is not currently exposed by the SDK |
| 把邮箱/手机**绑定**到已有账号；把微信合并到已有邮箱账号 | ❌ SDK 无「给已有账号追加标识 / 合并账号」接口（`updateUser` 只接受 `{nonce, password}`）；**改由应用层主体层实现**：绑定票据 + 身份并入，见下节 |
| 改昵称 / 头像 | ❌ `session.user.name` / `avatarUrl` 只读（来自 provider） |
| 云存储上传 | ✅ 可用，但本版按用户拍板用**内置头像集**，不引入 UserInfo 隐私项 |

「备用邮箱 / 手机」仍只是**应用层联系信息**（存 `user_profile`），不作为登录账号；真正的多登录方式由下面的统一用户主体承载。自助找回密码仍依赖账号本身的邮箱，手机号注册的账号无法自助找回，界面已明示。

### 数据表 `user_profile`

| 字段 | 说明 |
|---|---|
| `id` / `owner_id` | 主键；`owner_id` 默认 `auth.uid()`，不前端传 |
| `nickname` | 首次进入随机分配（如「沉静的旅人_4821」），可编辑 |
| `avatar_id` | 内置头像集 id（`ink-1` … `ink-12`） |
| `contact_email` / `contact_phone` | 备用联系方式 |
| `created_at` / `updated_at` | 时间戳 |

RLS 4 条策略与 `entries` / `todos` 同构：`SELECT / INSERT / UPDATE / DELETE` 全部 `owner_id = auth.uid()`。GRANT 只保留 `authenticated`（`anon` 已全部撤销）。`owner_id` 上有唯一索引 `user_profile_owner_id_key`。表在云端，与小程序 AppID 无关。

### 隐私协议

`pages/privacy/privacy` 内含《用户协议》与《隐私政策》全文（收集范围、大模型处理用途、云端隔离、第三方、用户权利、未成年人、更新与联系方式）。登录页底部有**勾选门禁**：未勾选时 `login-panel` 的 `submit()` 直接拒绝并提示，不发任何网络请求；两个链接分别跳转 `?doc=terms` / `?doc=privacy`。隐私清单 `.wbapp_*.privacy.json` 已声明 `Email` + `PhoneNumber`。

> 法律提示：文案为按本应用实际数据处理链路拟写的**模板**，正式发布前建议法务复核；微信公众平台的「用户隐私保护指引」表单仍需你本人在发布流程里填写，清单文件不等同于该表单已配置。

### 老账号迁移

此前用邮箱验证码登录、没有密码的账号：仍可用已有会话使用 App；退出前请到「我的 → 账号与安全 → 忘记密码 / 首次设置密码」用邮箱验证码设置密码，之后即可用账号密码登录。单一入口流程里若 `sendOtp` 判定账号已注册，会收起注册区并提示检查密码，不会误建新号。

### App 生命周期健壮性（2026-11-07 10:09 修复）

反馈：`cloud.auth.handleWorkBuddyMiniProgramCallback is not a function`。

| 核查 | 结论 |
|---|---|
| 真实 SDK 实例 | 方法**存在**（`AuthClient` 原型上有）；报错来自校验脚本 mock 里没有 `auth`，且脚本从未加载 `app.js`，因此 `onShow` 链路从未被模拟 |
| `app.js` | 改为 `authMethod(name)` 取方法并 `bind(this)`；缺方法时跳过并 `Promise.resolve(null)`，不再让 App 生命周期抛异常白屏。本应用用账号密码登录，WorkBuddy 账号回调是可选的脚手架能力 |
| 会话解析 | 新增 `sessionOf()` 统一处理 `{data, error}`；**未登录时 `data=null` 必须归为 `null`**，否则登录页会误判已登录（首轮改动曾引入此回归，已由校验抓出并修复） |
| `runtime-check.js` | mock 补齐 8 个 auth 方法、缓存单一 mock 实例、真实加载 `app.js` 跑 `onLaunch`/`onShow`；新增 `collectAuthMethodsUsed()` 自动扫描源码里所有 `cloud.auth.<name>` 调用断言覆盖；新增「缺方法不崩」「未登录返回 null」「有会话正确提取」三条回归。断言 28 → **37** |

另做了**真实 SDK 冒烟**（非 mock）：`onLaunch`/`onShow` 不抛异常，`sessionPromise` 与 `ensureSession()` 未登录态均返回 `null`。

## 同步设计稿其它页面 · A 批次「先补断链」（2026-11-09 15:4x–15:5x）

**范围由本人拍板**：设计稿 v2.1 共 17 屏（13 主屏 / 3 状态 / 1 深色），项目 `app.json` 原只注册 10 页。只读扫描出的缺口：

| 缺口 | 处理 |
|---|---|
| `pages/settings/` 4 文件早在 11-07 就建好，但**未注册 app.json** | 已注册 |
| `pages/messages/` **不存在**，而 `settings.js:57` 已 `navigateTo` 过去 → **现存死链，点击必报错** | 已新建 4 文件；素材 `images/icon-{bell,settings,broom,trash,msg-*}.png` 与 `utils/notifications.js` 的 `build/filter/unreadCount/markRead/markAllRead/clearAll` 均早已备齐，属半成品收口 |
| `pages/profile` 无齿轮/铃铛入口 | 已在 masthead 右上加齿轮（→ settings）+ 铃铛（→ messages），铃铛带未读红点；复用 `loadStats()` 已取到的 entries/todos 算未读数，**不额外发请求**；通知开关关闭时不显示红点 |
| WXML 里 `ACCOUNT &amp; PERSONAL` 被当字面文本输出 | 改为 `&`，settings 与 profile 各 1 处，重截确认显示为 `ACCOUNT & PERSONAL` |

**messages 页落地**（SCREEN 11/11b）：顶部返回 + 刷子（一键已读）/ 朱红描边垃圾桶（清空二次确认）；刊头 `NOTIFICATIONS / 消息中心` + `共 N 条 / 未读 N`；全部/系统/记录/待办 四个 chip；列表按 `mi / mb{mt,ms,mti} / right{time,ud}` 渲染，未读带朱红圆点；点单条标记已读；清空走 `sheet-backdrop` + 墨黑 `sheet` 二次确认。通知由 entries/todos 派生，不建云端表，已读/清空只写本地状态。

**真机实证**（IDE 已可打开这两页，页面栈分别为 `pages/messages/messages` / `pages/settings/settings` → 路由可达、**死链已修复**）：
- `.ide-shots/screen10-settings-20261109.jpg`（32,459 B）：分组、开关、底部「进入消息中心」全部渲染，`ACCOUNT & PERSONAL` 正确。
- `.ide-shots/screen11-messages-20261109.jpg`（26,713 B）：刊头、chips、2 条系统通知（含未读红点）全部渲染。
- `.ide-shots/screen06-profile-20261109.jpg`（34,417 B）：齿轮 + 铃铛（带红点）已出现，其余版面未动。

**回归**：`scripts/validate.js` 的 setData 绑定检查从 2 处扩到 4 处（新增 messages 5 key / settings 3 key，全部有绑定）；官方 wcc/wcsc 全量编译 **16 个 WXML**。四套全过：validate ✓ / compile-check **56** / runtime-check **92** / selfcheck **32**。

**已知边界（如实）**：`utils/notifications.js` 的系统通知 `time = Date.now()` 每次 build 都刷新，`clearAll()` 按时间点清空后重新进入会再出现系统通知 —— 已读状态按稳定 id 保存不受影响。本次未改该模块（不在 A 范围），列入候选。

**未做（B/C/D 批次，只列不做）**：按 SCREEN 06 把 profile 的账号/隐私/引擎三段移入设置页；01–05 主屏与 v2.1 细节逐屏核对；骨架屏/错误/空态三屏与深色模式 6 token。`pages/privacy/privacy.wxml` 第 17 行、「我的」页底部仍有「微信账号是独立身份…数据不互通」的过时文案，与已上线的统一账号体系矛盾，未动。

## 同步设计稿其它页面 · B / C / D 批次（2026-11-09 16:0x–16:2x）

用户拍板「B C D 一起做」，三批同时落地。

### B · SCREEN 06「我的」瘦身 + 三段移入设置页

- `pages/profile/profile.wxml` 删掉「账号与安全 / 隐私协议 / 智能引擎」三段共 2,264 字符，只留身份行、主数字统计、4 格细统计、退出登录；齿轮 / 铃铛（带未读红点）保留。
- `pages/profile/profile.js` 同步删掉 `llm` / `wechatAuth` / `maskAccount` 依赖、`loadModel()`、`onOpenAccount/Terms/Privacy` 及 7 个不再使用的 data 字段；`profile.wxss` 清掉 `settingrow*` / `rowhint` 死样式。
- `pages/settings/settings.wxml` 原本就有「账号与安全 ›」「隐私协议 ›」「智能引擎」行，**无需改动即承接三段**。

### C · SCREEN 01–05 逐屏核对

只读对比设计稿与项目 class：`timeline/day-group`、问答块 `answer + 依据 + 建议`、`todo-priority/due/del`、`action/engine-tag/regen`、详情 `point/related/todo-box` **11-06 ~ v1.6 已全部落地**。本轮补齐两处视觉细节：
- `pages/search`：引擎标签从纯文字改为朱红描边小 chip `.qa-tag`（`大模型 · 回答` / `本地检索 · 回答`）。
- `pages/detail`：原文 `.body-text` 加 4rpx 朱红左竖线，改编辑式引用块（SCREEN 05 `quote`）。

### D · 三状态屏 + 深色 6 token

- **SCREEN 12 骨架屏**：新建 `components/skeleton/`（`rows` 属性 + 观察器生成数组），按记录流版面渲染日期条、时间轴方块、标题/正文骨架线；`pages/index` 的 loading 态由 `jump-loader` 换为 `skeleton`。其它页保留既有小人动画（渐进替换，未动既定视觉）。
- **SCREEN 13 错误态**：`app.wxss` 的 `.error-text` 加 `::before` 朱红短线视觉锚；sad 小人 + 次按钮重试保留。
- **SCREEN 14 空态**：`.empty` 原本已是虚线框；新增 `.empty-action` 朱红主按钮，`pages/index` 空态加「写第一条记录」，点击回顶并聚焦输入框（`composerFocus`）。
- **SCREEN 15 深色模式**：`app.wxss` 定义 6 个 CSS 变量并用 `@media (prefers-color-scheme: dark)` 覆盖，值严格照设计稿 token 表（纸底 `#14140F` / 墨 `#F2EFE7` / 次墨 `#9A968C` / 细线 `#35342E` / 朱红 `#E8634A` / 纸白 `#1E1E18`）。**批量把 17 个 WXSS 的 306 处硬编码色值替换为 `var(--...)`**，不新增路由、不改字号/间距/结构。官方 `wcsc.exe` 编译产物确认保留 `prefers-color-scheme: dark` 与 40 处 `var(--)` 引用。settings 页「深色模式：跟随系统」与本实现一致。

**核验**：四套全过（validate ✓ / compile-check **58** / runtime-check **92** / selfcheck **32**）；官方 wcc/wcsc 编译 16 个 WXML。三张真机截图 `.ide-shots/screen06-profile-bcd-20261109.jpg`(26,068 B) / `screen01-index-bcd-20261109.jpg`(26,583 B) / `screen02-search-bcd-20261109.jpg`(23,420 B)：我的页三段已消失、图标仍在；记录页虚线空态框 + 朱红主按钮；检索页版面完整；**浅色渲染正常，证明变量化未破坏现有视觉**。

**已知边界（如实）**：深色模式跟随系统 `prefers-color-scheme`，本轮 IDE 未切系统深色，未出深色截图；`#A8A39B` 等次要占位色不在 6 token 内，深色下对比度可能偏弱。骨架屏只接在记录页 loading 态，其它页仍用小人动画。

## 当前真机预览码

| 项 | 实测值 |
|---|---|
| 预览入口（当前） | ① 微信开发者工具预览码：工作区 `.ide-shots/preview-qrcode.jpg`，**47,940 B，JPEG 470×470，2026-11-07 15:38 生成**（当前有效）。② WorkBuddy **小程序应用卡**「个人信息管家」（`wbapp_va5fLh2P6q1EkjTz693VC8`）→ 点开看当前效果；需要发布时点预览面板右上角「分享 / Share」 |
| 旧二维码 | 11:24 版 47,251 B（及更早的 46,778 / 45,838 / 47,795 B 等）**全部作废** |
| 本次重出码原因 | **统一用户账号体系（主体 + 多登录凭据）**：新增 `pages/bind/`、`utils/identity.js`、账号与安全页「登录方式」卡片、登录页补账与冲突提示、云端三张身份表（身份表 11 条策略 + 业务表 12 条策略 = 共 23 条）。工程代码已变 |
| IDE 门禁 | `check_wechatide_status --skill-version 0.3.11`：`versionRelation=equal`、`loginExpired=false`、`tokenRequired=false`、`cliTokenRequired=false`、`mcpTokenRequired=true` |
| 包体 | `auto_preview` success，代码包 **430,322 B**（约 420 KB）；比 11:24 版 398,812 B 增加 31,510 B（`utils/identity.js` 16,305 B + `pages/bind/` 四文件约 21 KB + 账号页/登录页改动）。`README.md`(49,044 B)、`scripts/`(65,400 B)、`sql/`(11,507 B) 未被 `packOptions.ignore` 排除、占入包约 126 KB，如需精简可单独处理 |
| 四套校验 | selfcheck 32/32、validate 全通过（含 4 处 setData 绑定检查）、compile-check **58/58**、runtime-check **92/92** |
| IDE 编译校验 | 微信开发者工具 `compile_wxml` **12 个文件全部 success**（`pages/*` 10 + `login-panel` + `avatar-picker` + `custom-tab-bar`）；`compile_wxss` **12 个文件全部 success**。`simulator_refresh` success，`get_simulator_console grep -i error` **返回空**（无错误行） |
| 域名 | `https://mp-api.app.workbuddy.host` 已在 mp 后台登记 request 合法域名 |

> 说明：`create_preview_qrcode --qr-format image --qr-output <path>` 返回的是 **JPEG Buffer**（头 `FF D8 FF E0`），即使路径写 `.png` 落地仍是 JPEG，故按真实格式用 `.jpg`。扫码前建议在微信里删掉旧的预览记录，避免加载到缓存包。

**IDE 验证边界（如实）**：以下三张是 **11-07 旧版留证**，**不代表 SCREEN 07 改版后的当前包**。11-09 15:20 已验通 `wechatide` CLI（`versionRelation=equal` / `loginExpired=false`）并用 `simulator_screenshot` 出了当前包登录页的真机截图 `.ide-shots/screen07-live-final-20261109.jpg`（336×726，31,927 B，最终版），详见下方「15:20 真机截图核验」。

| 截图 | 内容 |
|---|---|
| `.ide-shots/ui-v3/01-login.jpg` | **旧版**冷启动登录页：刊头「登录后开始记录」+ 登录/注册 tab + 账号 + 密码 + 登录按钮 + 忘记密码 + 「或」+ 微信登录 + 「独立账号」提示 + 底部未勾选的协议勾选框与《用户协议》《隐私政策》链接 |
| `.ide-shots/ui-v3/02-bind.jpg` | 绑定页（标题栏「绑定登录方式」）—— **IDE 未登录态下内容为空**：页内 `ensureSession()` 判定无会话后 `guard.goLogin()` 跳转登录页，属门禁正常行为，非渲染缺陷 |
| `.ide-shots/ui-v3/03-account.jpg` | 账号与安全页（标题栏「账号与安全」）—— 同样在未登录态下被门禁重定向，内容为空 |

`automation_runtime_info --action pageStack` 实证跳转链：打开 `pages/bind/bind` 后页面栈变为 `pages/login/login?from=pages/index/index`，确认未登录拦截生效。

**仍需真机留证的登录态页面**：「我的」「账号与安全」「绑定登录方式」「隐私协议」四个页面在 IDE 无法登录，**未留证**，需真机扫码验证；全量 JS 语法检查、事件绑定对应检查、四套校验与官方 wcc/wcsc 编译均通过。


**微信登录前置条件（setup gap）**：需在 WorkBuddy Auth 管理页开启微信登录 Provider，并在小程序应用预览面板完成**绑定/授权**。当前会话无该管理能力，**未声称开关已启用**；H5 预览拿不到真实 `wx.login` code，必须在微信内验证。

#### 真机实测（2026-11-07 10:40）：「小程序未授权给workbuddy」

**不是代码缺陷**。核查：云服务 `inspect` = ACTIVE / `billingStatus=normal`；工程 `project.config.json` 的 `appid=wx32052cb43eaf4910` 是真实 AppID（非游客态），`utils/wechat-auth.js` 取 appid 的路径正确，且只是把云端错误原样展示、没有伪造会话。错误来自云端 `login-wechat`：该 AppID 尚未授权给 WorkBuddy 第三方平台。官方 `mini-program-development/references/validation-and-recovery.md` 规定授权类错误不猜代码修复方案，直接采用平台文案。

**解决步骤（本人操作）**：
1. 打开小程序应用预览卡 → 右上角「分享 / Share」（刷新与「…」之间）→ 查看绑定状态。
2. 选「绑定已有小程序」→ 用**小程序管理员微信扫码授权**；只想体验可选「试用小程序」（临时、有有效期）。
3. 确认绑定的 AppID 与 `project.config.json` 的 `wx32052cb43eaf4910` **一致**，否则仍会报同一错。
4. **（可先跳过）** WorkBuddy Auth 管理页的「微信登录」开关：官方 `auth/management.md` 只给出内部 API 路径 `WorkBuddy Auth page → /genie-baas/admin/auth/**`，**未给出客户端菜单路径**；当前会话也没有可调用该管理能力的工具；开关数据源 `workbuddy_application_config.wechat_login_enabled` 位于平台管理库，业务云数据库中查不到（`auth.provider` 4 条记录 `enabled=1` 是 TCB 侧 provider，不是这个开关）。因此入口与状态**均无法确证**。当前报错指向绑定而非开关，先完成第 2 步绑定再重测；若错误变为「登录方式未启用」类，再回头查开关。该开关与「小程序绑定」是**两件独立的事**，开启开关不会自动完成绑定。唯一在 `delivery.md` 出现过的设置路径是「设置 > 数据管理 > 应用」，可点进本应用看是否有「认证 / Auth / 登录方式」标签，但这是**推测入口，非文档确证**。
5. 面板点「更新」重新发布最新代码（改完代码不会自动同步）。
6. **用分享面板发布的体验版小程序码**在微信内测试。`.ide-shots/preview-qrcode.jpg` 是微信开发者工具预览码，走工程 AppID 的授权链路，绑定完成后仍可能失败，不要用它验微信登录。

用户选择 **A：不改代码，先完成授权**。本轮未改动任何 JS / WXML / 云端配置，未重新出码。

### 待办：真机回归（需本人操作）

> 11:33 那 4 张截图是**改版前 + 登录页拆分前**的留证，不代表当前包。当前包需重新验证。

扫码后按下列顺序核对。邮箱/短信验证码需本人收码，agent 不代劳：

1. 未登录冷启动 → **首屏就是登录页**（SCREEN 07：`SIGN IN / 个人空间` 刊头 + 80rpx 衬线「登录」+ meta + 按来源的引导小字 + 字段标签 + 224rpx 居中朱红「登录」+ 忘记密码 / 没有账号？注册 + 「或」分隔线 + 描边微信登录 + 协议勾选）。**不再有登录/注册 tab、提交反馈框、微信说明、页脚**。
2. **协议门禁**：不勾选协议直接点「登录」或「微信登录」→ 都提示「请先阅读并同意…」，不发网络请求；两个链接能打开全文页。
3. 登录：账号格式错误 / 密码为空 / 密码少于 6 位 → 页内错误文本；账号密码登录成功 → 进主应用首页。
4. **单一入口自动检测**：填未注册过的账号 + 密码 → 点「登录」→ 自动展开「确认密码 + 验证码」区并收到验证码（60 秒倒计时）→ 填全后点「创建并登录」→ 建号并进主应用；页内 `login-tip` 提示「该账号未注册，验证码已发送，填完即可创建并登录」。两次密码不一致、未发码、验证码为空均有提示。
4a. **已注册 / 密码错**：已注册账号密码正确 → 直接登录且**不发送验证码**；密码打错 → 只提示错误、不展开注册区、不误发验证码；点「没有账号？注册」手动展开后，若该账号其实已注册 → 收起注册区并提示检查密码。
5. **已登录冷启动** → 直接进记录页，不闪登录页；退出登录后回到登录页。
6. **老账号**：此前用验证码登录、无密码的账号，退出前在「我的 → 账号与安全」用邮箱验证码设置密码。
7. **忘记密码**：登录页「忘记密码」→ 注册邮箱 + 验证码 + 新密码 → 重置后自动登录。
8. **UI 改版**：4 主屏刊头、纸底墨字、朱红按钮、细线分组；记录流按日期分组 + 时间轴方块；胶囊 Tab Bar 激活态正确；加载时小人跳动。
9. **异常态沮丧小人**：断网关服务，错误态显示跪倒落泪小人 + 塌陷过渡；错误文案与重试按钮保持原样。
10. **已登录态版式**：输入区、记录列表、待办列表、总结数据版式。
11. **详情页**：关联内容正常显示；**未登录进详情应跳登录页**（本轮补的门禁），不再显示误导性的「记录不存在」。
12. **检索页长文本复制**：长按结果预览 / 回答正文可选中复制。
13. **检索页搜索行**：按钮紧凑、与输入框等高。
14. **「我的」版面**（按设计稿 SCREEN 06）：刊头「ACCOUNT / 个人空间 · 我的」+ 身份行（方形色底单字头像 + 昵称 + 编辑）+ 主数字统计（N 条记录 / 未完成 M）+ 4 格细统计（想法/资料/待办/未完成）+ 账号与安全 5 行 + 隐私协议 2 行 + 智能引擎 1 行 + 文字式退出登录；细线分组、无白卡片。
15. **玻璃胶囊**：全透明 + 背景模糊 + 亮色高光描边 + 投影；文字清晰；按压反馈；底部内容不被压住。
16. **「我的」资料**：随机昵称、12 款内置头像即时生效、昵称编辑校验、重进保留。
17. **账号与安全**：掩码账号、备用邮箱手机保存回显、改密码、邮箱验证码设密码。
18. **隐私协议**：《用户协议》《隐私政策》全文可滚动，含大模型用途、用户权利、**微信登录说明**。
19. **微信登录**（需先在 Auth 管理页开启 Provider + 绑定小程序）：微信内点「微信登录」→ 首次弹「这是独立账号」说明 → 进主应用；再冷启动用微信登录仍进同一账号、数据还在；H5 预览或未绑定 AppID 给友好提示不白屏。
20. **账号类型适配**：微信账号下「我的」显示「微信账号」、账号与安全**隐藏**改密码/邮箱找回；密码账号保持原样；两种账号切换登录后数据各自独立。
21. **权限隔离实证**：用两个不同账号各写一条记录，互相按对方 id 执行改 / 删 / 查，均应返回 0 行（验证 RLS + 撤销 anon 后未登录不可读写）。
22. **待办方框交互**：只点左侧方框才打勾/取消；点标题文字、内容区、整行空白处、优先级/截止日期区域均**不改变状态**；「来自记录」「删除」「已完成展开/收起」仍正常；快速连点方框不重复提交、不出现状态抖动；已完成条目点方框可恢复未完成。
23. **「我的」页功能保留**：点头像弹出方形内置头像选择器并即时生效；点「编辑」可改昵称；账号与安全 5 行可跳二级页；《用户协议》《隐私政策》两行可打开全文；文字式「退出登录」仍可用。
24. **登录方式卡片**：「我的 → 账号与安全」新增「登录方式」区，三行（微信 / 邮箱 / 手机号）分别显示「已绑定 + 掩码」或「未绑定 + 绑定按钮」；已绑定的行不再显示绑定按钮。
25. **绑定邮箱（同一主体）**：账号密码登录 → 账号与安全 → 邮箱「绑定」→ 输入邮箱 → 获取验证码 → 该邮箱**从未注册过**时要补一个密码 → 确认绑定 → 回到账号页显示「已绑定」；此时用该邮箱 + 密码登录，**看到的是同一批记录**（不是空账号）。
26. **绑定微信（同一主体）**：账号密码登录 → 绑定微信 → 微信授权 → 回到账号页显示微信「已绑定」；退出后用微信登录进入**同一个账号**，记录仍在。
27. **归属冲突**：用一个**已被另一个账号占用**的邮箱去点绑定 → 验码后应弹出「归属冲突」卡片（说明合并会让两个账号的数据互相可见），**默认不合并**；点「合并到当前账号」后才并入；点「稍后再说」则两个账号保持独立。合并后用两个账号分别登录，看到的都是合并后的同一份数据。
28. **绑定失败可重试**：绑定流程中途断网 → 提示「已用该方式登录，但并入原账号未成功」并出现「重试绑定」；点重试成功后应正常显示已绑定；原账号记录全程不受影响。

## 发布

预览卡在 WorkBuddy 内生成，工程文件都在本地。当前状态是**未发布**：上传体验版、绑定小程序、提交审核与正式发布，需要在应用预览面板右上角点「分享 / Share」继续，由你确认后完成。H5 预览无法完成原生授权往返，登录请在微信内验证。
