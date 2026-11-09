/**
 * 运行时链路模拟（不依赖微信开发者工具 / 真机）。
 *
 * 用 mock 的 cloud SDK 替换 utils/cloud.js，把以下链路在 Node 里真实跑一遍：
 *   1. models.list() 返回数组（SDK 真实形态）时能选中非推理模型
 *   2. 每次对话首条消息必须是 system（官方 SDK 硬性要求）
 *   3. 分析 / 问答 / 阶段总结三条大模型分支都能走通（engine === 'llm'）
 *   4. 模型调用失败时自动回落本地规则引擎（engine === 'local'）
 *   5. store 的驼峰字段 ↔ 数据库下划线字段映射往返无损
 *   6. App 生命周期（onLaunch / onShow）完整跑通；自动扫描源码里所有
 *      `cloud.auth.<name>` 调用并断言 mock 全覆盖，且 SDK 缺方法时不崩
 *   7. 模型列表 `{data:[...]}` 包装形态兼容
 *
 * 用法：node scripts/runtime-check.js
 *
 * 注意：这是链路模拟，不是真机验证。登录、数据库读写、网络请求仍需微信里实测。
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const CLOUD_PATH = path.join(ROOT, 'utils', 'cloud.js');

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
    if (cond) {
        pass += 1;
        console.log('  OK   ' + label + (detail ? '  ' + detail : ''));
    } else {
        fail += 1;
        console.log('  FAIL ' + label + (detail ? '  ' + detail : ''));
    }
}

// 与线上模型目录同构的最小样本：首个是推理模型 auto，后面有普通对话模型
const MODELS = [
    { id: 'auto', name: 'Auto', enabled: true, onlyReasoning: true },
    { id: 'hy3', name: 'Hy3', enabled: true, onlyReasoning: true },
    { id: 'hunyuan-chat', name: 'Hunyuan-Turbos', enabled: true },
    { id: 'disabled-model', name: 'Off', enabled: false },
];

const observed = { payloads: [], modelListCalls: 0, authCalls: [] };
let failChat = false;
let listShape = 'array'; // 'array' | 'wrapped'

function makeCloud() {
    // 记录调用，便于断言 App 生命周期真的跑过了对应链路
    function auth(name, impl) {
        return async function () {
            observed.authCalls.push(name);
            return impl.apply(null, arguments);
        };
    }
    return {
        // store.js 在模块加载时会校验 cloud.database.from 存在；本脚本不实际发起 CRUD
        database: {
            from: function () {
                return {
                    select: function () { return this; },
                    insert: function () { return this; },
                    update: function () { return this; },
                    delete: function () { return this; },
                    order: function () { return this; },
                    eq: function () { return this; },
                };
            },
        },
        llm: {
            models: {
                list: async function () {
                    observed.modelListCalls += 1;
                    return listShape === 'array' ? MODELS : { data: MODELS };
                },
            },
            chat: {
                completions: {
                    create: async function* (payload) {
                        observed.payloads.push(payload);
                        if (failChat) throw new Error('mock model unavailable');
                        const isJson = !!payload.response_format;
                        const content = isJson
                            ? JSON.stringify({
                                type: 'todo',
                                category: '财务结算',
                                tags: ['账单'],
                                keywords: ['对账'],
                                summary: '核对九月账单并确认口径',
                                keyPoints: ['金额 128500 元'],
                                todos: [{ title: '完成账单核对', priority: 'high', due: '本周五' }],
                                actions: [{ title: '确认对账口径', detail: '与财务对齐后开始核对' }],
                            })
                            : '结论：已完成对账。【记录1】记录了金额与截止时间。建议先与财务确认口径。';
                        yield { choices: [{ delta: { content: content } }] };
                    },
                },
            },
        },
        // app.js / 登录组件 / 账号页 / 我的页会用到的全部 auth 方法
        auth: {
            getSession: auth('getSession', function () {
                return { data: null, error: null };
            }),
            handleWorkBuddyMiniProgramCallback: auth('handleWorkBuddyMiniProgramCallback', function () {
                return { data: null, error: null };
            }),
            signInWithPassword: auth('signInWithPassword', function () {
                return { data: { user: { name: 'mock-user' } }, error: null };
            }),
            signInWithWechat: auth('signInWithWechat', function (code, appid) {
                if (!code || !appid) return { data: null, error: { message: 'missing code/appid' } };
                return {
                    data: { user: { id: 'wx-mock-user', raw: { provider: 'wechat', sub: 'wx-mock-user' } } },
                    error: null,
                };
            }),
            // onAuthStateChange 真实返回 unsubscribe，且会立即以 INITIAL_SESSION 回调一次
            onAuthStateChange: function (callback) {
                observed.authCalls.push('onAuthStateChange');
                if (typeof callback === 'function') callback('INITIAL_SESSION', null);
                return function () {};
            },
            sendOtp: auth('sendOtp', function () {
                return { data: { verificationId: 'v-mock', isExistingUser: false }, error: null };
            }),
            verifyOtp: auth('verifyOtp', function () {
                return { data: { user: { name: 'mock-user' } }, error: null };
            }),
            resetPasswordForEmail: auth('resetPasswordForEmail', function () {
                return {
                    data: { updateUser: async function () { return { data: {}, error: null }; } },
                    error: null,
                };
            }),
            resetPasswordForOld: auth('resetPasswordForOld', function () {
                return { data: {}, error: null };
            }),
            signOut: auth('signOut', function () {
                return { data: {}, error: null };
            }),
        },
    };
}

// 缓存单个 mock 实例，保证 cloud.auth 引用稳定（与真实 SDK 一致）
const mockCloudInner = makeCloud();
const mockCloud = new Proxy({}, {
    get(_t, prop) {
        return mockCloudInner[prop];
    },
});

// 在 require 之前注入 mock，让 utils/llm.js、utils/store.js、app.js 都拿到假 SDK
require.cache[CLOUD_PATH] = {
    id: CLOUD_PATH,
    filename: CLOUD_PATH,
    loaded: true,
    exports: { cloud: mockCloud, getCloud: () => mockCloud, PUBLIC_CONFIG: {} },
    children: [],
    paths: [],
};

/**
 * 扫描业务源码里实际调用的 cloud.auth.<name> / authMethod('<name>')，
 * 用于断言 mock 覆盖了全部方法。以后新增调用会自动在这里被抓到，
 * 避免再次出现「脚本模拟不完整、真机才报 is not a function」。
 */
function collectAuthMethodsUsed() {
    const names = new Set();
    const files = [];
    const skip = new Set([
        'node_modules', 'miniprogram_npm', 'scripts', '.buildcheck', '.git', '.workbuddy',
    ]);
    function walk(dir) {
        for (const f of fs.readdirSync(dir)) {
            if (skip.has(f)) continue;
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (f.endsWith('.js')) files.push(full);
        }
    }
    walk(ROOT);
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        let m;
        const direct = /\b(?:cloud\.auth|store\.cloud\.auth)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
        while ((m = direct.exec(src))) names.add(m[1]);
        const guard = /authMethod\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g;
        while ((m = guard.exec(src))) names.add(m[1]);
    }
    return names;
}

/** 用最小全局环境加载 app.js，拿到 App({...}) 的配置对象 */
function loadAppConfig() {
    delete require.cache[path.join(ROOT, 'app.js')];
    let config = null;
    global.App = function (options) { config = options; };
    global.getApp = function () {
        return {
            globalData: {},
            ensureSession: async function () { return null; },
            resetSession: function () {},
        };
    };
    global.wx = global.wx || {};
    require(path.join(ROOT, 'app.js'));
    return config;
}

async function main() {
    console.log('运行时链路模拟  ' + ROOT);
    console.log('');

    const llm = require(path.join(ROOT, 'utils', 'llm.js'));
    const svc = require(path.join(ROOT, 'utils', 'ai-service.js'));
    const store = require(path.join(ROOT, 'utils', 'store.js'));
    const ai = require(path.join(ROOT, 'utils', 'ai.js'));

    // 1. 模型列表（数组形态）
    console.log('[1/11] 模型列表与选模');
    const models = await llm.listModels();
    check('SDK 返回数组时 listModels() 得到 4 项', models.length === 4, '实际 ' + models.length);
    const model = await llm.resolveModel();
    check('跳过推理模型 auto / disabled，选中普通对话模型', model.id === 'hunyuan-chat', '实际 ' + model.id);
    check('模型列表有缓存，只拉取一次', observed.modelListCalls === 1, '调用 ' + observed.modelListCalls + ' 次');

    // 2. 三条大模型分支
    console.log('[2/11] 大模型分支');
    const content = '明天上午要把京信9月的账单核对完，发票金额 128500 元，截止本周五，记得提前跟财务确认对账口径。';
    const a = await svc.analyzeEntry(content);
    check('单条记录分析走大模型', a.engine === 'llm', 'engine=' + a.engine);
    check('大模型结果待办字段映射正确', a.todos && a.todos.length === 1 && a.todos[0].title === '完成账单核对',
        JSON.stringify(a.todos));

    const now = Date.now();
    const entries = [
        { id: 1, type: 'todo', title: '账单核对', content: content, category: '财务结算', tags: ['账单'], keywords: ['对账'], todoItems: [], createdAt: now, updatedAt: now },
        { id: 2, type: 'material', title: '对账口径', content: '账单核对前要跟财务确认对账口径，发票金额以系统为准。', category: '财务结算', tags: ['账单'], keywords: ['对账'], todoItems: [], createdAt: now, updatedAt: now },
    ];
    const q = await svc.askQuestion(entries, '账单核对要做什么');
    check('智能问答走大模型', q.engine === 'llm', 'engine=' + q.engine);
    check('问答附上依据记录', q.refs && q.refs.length > 0, 'refs=' + (q.refs ? q.refs.length : 0));

    const r = await svc.buildStageReport(entries, 7);
    check('阶段总结走大模型', r.engine === 'llm', 'engine=' + r.engine);
    check('阶段总结保留本地统计口径', r.stats && typeof r.stats.total === 'number', JSON.stringify(r.stats));

    // 3. system 消息约束
    console.log('[3/11] 对话请求约束');
    check('共发出 3 次对话请求', observed.payloads.length === 3, '实际 ' + observed.payloads.length);
    const allSystem = observed.payloads.every(function (p) {
        return p.messages && p.messages[0] && p.messages[0].role === 'system';
    });
    check('每次请求首条都是 system 消息', allSystem);
    check('每次请求都带 model 且 stream=true', observed.payloads.every(function (p) {
        return p.model === 'hunyuan-chat' && p.stream === true;
    }));
    check('结构化请求带 response_format', observed.payloads.filter(function (p) {
        return p.response_format && p.response_format.type === 'json_object';
    }).length === 2);

    // 4. 失败回落
    console.log('[4/11] 模型不可用时回落');
    failChat = true;
    const a2 = await svc.analyzeEntry(content);
    check('分析回落到本地规则引擎', a2.engine === 'local', 'engine=' + a2.engine);
    check('回落结果仍可用', !!a2.summary && Array.isArray(a2.todos), 'summary=' + a2.summary.slice(0, 20));
    const q2 = await svc.askQuestion(entries, '账单核对要做什么');
    check('问答回落到本地规则引擎', q2.engine === 'local', 'engine=' + q2.engine);
    const r2 = await svc.buildStageReport(entries, 7);
    check('阶段总结回落到本地规则引擎', r2.engine === 'local', 'engine=' + r2.engine);
    check('回落阶段总结仍有行动建议', r2.actions && r2.actions.length > 0,
        'actions=' + (r2.actions ? r2.actions.length : 0));
    failChat = false;

    // 5. 字段映射往返
    console.log('[5/11] 数据层字段映射');
    const payload = {
        type: 'todo', title: '账单核对', content: content, category: '财务结算',
        tags: ['账单'], keywords: ['对账'], summary: '摘要', keyPoints: ['金额'],
        todoItems: [{ title: '完成核对', done: false, priority: 'high', due: '本周五' }],
        relatedIds: [2, 3],
    };
    const row = store.toEntryRow(payload);
    check('驼峰 → 下划线：key_points', Array.isArray(row.key_points) && row.key_points[0] === '金额');
    check('驼峰 → 下划线：todo_items', Array.isArray(row.todo_items) && row.todo_items[0].title === '完成核对');
    check('驼峰 → 下划线：related_ids', Array.isArray(row.related_ids) && row.related_ids.length === 2);
    check('不向前端发送 owner_id', row.owner_id === undefined);
    const back = store.fromEntryRow(Object.assign({
        id: 9, owner_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, row));
    check('下划线 → 驼峰：keyPoints', back.keyPoints[0] === '金额');
    check('下划线 → 驼峰：todoItems', back.todoItems[0].title === '完成核对');
    check('下划线 → 驼峰：relatedIds', back.relatedIds.length === 2);
    check('时间戳转为毫秒数', typeof back.createdAt === 'number', 'createdAt=' + back.createdAt);
    check('关联计算可消费映射后的对象', typeof ai.relate(back, entries, 3).length === 'number');

    // 6. App 生命周期 + auth mock 完整性（复现并防住 "is not a function"）
    console.log('[6/11] App 生命周期与 auth 模拟完整性');
    const used = collectAuthMethodsUsed();
    const missing = Array.from(used).filter(function (name) {
        return typeof mockCloudInner.auth[name] !== 'function';
    });
    check('源码使用的 auth 方法全部被 mock 覆盖', missing.length === 0,
        '共 ' + used.size + ' 个；缺失：' + (missing.join(', ') || '无'));
    check('mock 含 handleWorkBuddyMiniProgramCallback',
        typeof mockCloudInner.auth.handleWorkBuddyMiniProgramCallback === 'function');

    observed.authCalls.length = 0;
    const appConfig = loadAppConfig();
    let lifecycleError = null;
    try {
        appConfig.onLaunch.call(appConfig);
        await appConfig.onShow.call(appConfig, {});
        await appConfig.sessionPromise;
        await appConfig.workBuddyAuthReady;
    } catch (error) {
        lifecycleError = error;
    }
    check('onLaunch / onShow 完整跑通不抛异常', lifecycleError === null,
        lifecycleError ? lifecycleError.message : '');
    check('onLaunch 真的调了 getSession', observed.authCalls.indexOf('getSession') >= 0,
        observed.authCalls.join(','));
    check('onShow 真的调了 WorkBuddy 账号回调',
        observed.authCalls.indexOf('handleWorkBuddyMiniProgramCallback') >= 0);
    check('sessionPromise 是 Promise', appConfig.sessionPromise instanceof Promise);
    const ensured = await appConfig.ensureSession();
    check('未登录时 ensureSession() 返回 null，不误判已登录', ensured === null,
        JSON.stringify(ensured));

    // 回归：有会话时能从 { data, error } 里正确提出 session
    const savedGetSession = mockCloudInner.auth.getSession;
    mockCloudInner.auth.getSession = async function () {
        return { data: { user: { name: 'signed-user' } }, error: null };
    };
    const appConfig3 = loadAppConfig();
    appConfig3.onLaunch.call(appConfig3);
    const signed = await appConfig3.sessionPromise;
    check('有会话时 onLaunch 提取到 session.user', !!signed && signed.user && signed.user.name === 'signed-user',
        JSON.stringify(signed));
    mockCloudInner.auth.getSession = savedGetSession;

    // 回归：SDK / mock 缺该方法时，App 生命周期仍不能崩
    const savedHandler = mockCloudInner.auth.handleWorkBuddyMiniProgramCallback;
    delete mockCloudInner.auth.handleWorkBuddyMiniProgramCallback;
    const appConfig2 = loadAppConfig();
    let guardError = null;
    try {
        appConfig2.onLaunch.call(appConfig2);
        await appConfig2.onShow.call(appConfig2, {});
        await appConfig2.workBuddyAuthReady;
    } catch (error) {
        guardError = error;
    }
    check('缺少回调方法时 onShow 不抛 is not a function', guardError === null,
        guardError ? guardError.message : '');
    mockCloudInner.auth.handleWorkBuddyMiniProgramCallback = savedHandler;

    // 7. 微信登录链路与账号类型判定
    console.log('[7/11] 微信登录与账号类型');
    const wechatAuth = require(path.join(ROOT, 'utils', 'wechat-auth.js'));
    const savedWx = global.wx;
    const wxStore = {};
    global.wx = {
        getAccountInfoSync: function () { return { miniProgram: { appId: 'wxmockappid' } }; },
        login: function (o) { o.success({ code: 'mock-code' }); },
        getStorageSync: function (k) { return wxStore[k]; },
        setStorageSync: function (k, v) { wxStore[k] = v; },
    };
    const wxResult = await wechatAuth.signIn();
    check('wx.login + signInWithWechat 成功', !wxResult.error && !!wxResult.data,
        JSON.stringify(wxResult.error || {}));
    check('微信登录真的调了 SDK signInWithWechat',
        observed.authCalls.indexOf('signInWithWechat') >= 0);
    check('从会话 JWT raw 识别为微信账号', wechatAuth.accountType(wxResult.data) === 'wechat');

    wechatAuth.markProvider('wechat');
    check('本地登录方式标记也能识别微信账号', wechatAuth.accountType(null) === 'wechat');
    check('首次微信登录提示只弹一次（标记可读写）',
        wechatAuth.shouldShowWechatNotice() === true &&
        (wechatAuth.markWechatNoticeShown(), wechatAuth.shouldShowWechatNotice() === false));

    global.wx.login = function (o) { o.fail({ errMsg: 'login:fail mock' }); };
    const noCode = await wechatAuth.signIn();
    check('wx.login 失败返回友好错误且不抛异常',
        !!noCode.error && /凭证|重试/.test(noCode.error.message));

    global.wx.getAccountInfoSync = function () {
        return { miniProgram: { appId: 'touristappid' } };
    };
    const noAppid = await wechatAuth.signIn();
    check('游客态 appid 返回友好错误',
        !!noAppid.error && /未绑定|体验版/.test(noAppid.error.message));
    global.wx = savedWx;

    // 8. 模型列表包装形态兼容（重新加载模块，清缓存）
    console.log('[8/11] 模型列表兼容形态');
    delete require.cache[path.join(ROOT, 'utils', 'llm.js')];
    listShape = 'wrapped';
    const llm2 = require(path.join(ROOT, 'utils', 'llm.js'));
    const models2 = await llm2.listModels();
    check('{data:[...]} 形态同样解析为 4 项', models2.length === 4, '实际 ' + models2.length);

    // 9. 待办完成状态交互（只有方框能切换，连续点击不重复提交）
    console.log('[9/11] 待办方框交互');
    const originUpdate = store.todos.update;
    const updateCalls = [];
    store.todos.update = async function (id, patch) {
        updateCalls.push({ id: id, patch: patch });
        return { data: { id: id, title: 'mock', status: patch.status }, error: null };
    };

    const todoPath = path.join(ROOT, 'pages', 'todo', 'todo.js');
    delete require.cache[todoPath];
    let todoPage = null;
    global.Page = function (options) { todoPage = options; };
    global.getApp = function () {
        return {
            ensureSession: async function () { return { user: {} }; },
            resetSession: function () {},
        };
    };
    global.wx = { showToast: function () {}, showModal: function () {}, navigateTo: function () {} };
    require(todoPath);
    todoPage.setData = function (patch) { Object.assign(this.data, patch); };

    const openEvt = { currentTarget: { dataset: { id: 11, status: 'open' } } };
    updateCalls.length = 0;
    const first = todoPage.onToggle(openEvt);
    const second = todoPage.onToggle(openEvt);
    await Promise.all([first, second]);
    check('连续点击方框只发出 1 次状态更新', updateCalls.length === 1, '实际 ' + updateCalls.length);
    check('未完成条目点方框 → status=done',
        updateCalls.length === 1 && updateCalls[0].patch.status === 'done');

    updateCalls.length = 0;
    await todoPage.onToggle({ currentTarget: { dataset: { id: 12, status: 'done' } } });
    check('已完成条目点方框 → status=open（可取消完成）',
        updateCalls.length === 1 && updateCalls[0].patch.status === 'open');

    updateCalls.length = 0;
    await todoPage.onToggle(openEvt);
    check('请求结束后锁已释放，下一次点击仍可生效', updateCalls.length === 1);

    store.todos.update = originUpdate;

    console.log('[10/11] 统一用户主体：凭据归属、绑定票据与归属冲突');

    // 内存版身份库：复刻云端 RLS 的判定口径（谁能读、谁能写、票据是否有效），
    // 目的是把「同一标识只能属于一个主体」「不同用户的数据不被合并」这两条
    // 在本地先跑一遍，而不是只靠真机点。
    const idb = {
        rows: { user_link: [], user_credential: [], user_bind_ticket: [] },
    };
    // 当前会话 uid：假库按它判定 RLS，换账号时只改这里
    const sessionHolder = { uid: 'uid-A' };

    function rlsError(message) {
        return { kind: 'permission-denied', message: message || 'RLS denied', status: 403, code: '42501' };
    }
    function dupError() {
        return {
            kind: 'unknown',
            message: 'duplicate key value violates unique constraint "user_credential_pkey"',
            status: 409,
            code: '23505',
        };
    }
    function subjectOf(uid) {
        const link = idb.rows.user_link.filter(function (r) { return r.uid === uid; })[0];
        return link ? link.subject_id : uid;
    }
    function ticketValid(ticketId, subject) {
        if (!ticketId) return false;
        const t = idb.rows.user_bind_ticket.filter(function (r) { return r.id === ticketId; })[0];
        if (!t) return false;
        if (t.subject_id !== subject) return false;
        if (t.used_at) return false;
        return new Date(t.expires_at).getTime() > Date.now();
    }
    function visibleRows(table) {
        const subject = subjectOf(sessionHolder.uid);
        if (table === 'user_link') {
            return idb.rows.user_link.filter(function (r) {
                return r.uid === sessionHolder.uid || r.subject_id === subject;
            });
        }
        if (table === 'user_credential') {
            return idb.rows.user_credential.filter(function (r) { return r.subject_id === subject; });
        }
        if (table === 'user_bind_ticket') {
            return idb.rows.user_bind_ticket.filter(function (r) { return r.subject_id === subject; });
        }
        return [];
    }

    function fakeDb() {
        function builder(table) {
            const q = { mode: 'read', payload: null, filters: [], order: null };
            const api = {
                select: function () { return api; },
                insert: function (row) { q.mode = 'insert'; q.payload = row; return api; },
                update: function (row) { q.mode = 'update'; q.payload = row; return api; },
                delete: function () { q.mode = 'delete'; return api; },
                eq: function (col, val) { q.filters.push([col, val]); return api; },
                order: function (col, opts) { q.order = { col: col, opts: opts }; return api; },
                then: function (resolve, reject) {
                    return Promise.resolve().then(execute).then(resolve, reject);
                },
            };

            function execute() {
                const rows = idb.rows[table] || [];

                if (q.mode === 'read') {
                    let list = visibleRows(table).slice();
                    q.filters.forEach(function (pair) {
                        list = list.filter(function (r) { return r[pair[0]] === pair[1]; });
                    });
                    if (q.order) {
                        const dir = q.order.opts && q.order.opts.ascending === false ? -1 : 1;
                        list.sort(function (a, b) {
                            return String(a[q.order.col] || '').localeCompare(String(b[q.order.col] || '')) * dir;
                        });
                    }
                    return { data: list.map(function (r) { return Object.assign({}, r); }), error: null };
                }

                if (q.mode === 'insert') {
                    const row = Object.assign({}, q.payload);
                    if (table === 'user_link') {
                        if (row.uid !== sessionHolder.uid) return { data: null, error: rlsError('uid 必须是当前会话') };
                        if (row.subject_id !== row.uid && !ticketValid(row.ticket_id, row.subject_id)) {
                            return { data: null, error: rlsError('缺少有效绑定票据') };
                        }
                        if (rows.some(function (r) { return r.uid === row.uid; })) {
                            return { data: null, error: dupError() };
                        }
                        row.created_at = row.created_at || new Date().toISOString();
                        rows.push(row);
                        return { data: [Object.assign({}, row)], error: null };
                    }
                    if (table === 'user_credential') {
                        const subject = subjectOf(sessionHolder.uid);
                        if (row.subject_id !== subject || row.uid !== sessionHolder.uid) {
                            return { data: null, error: rlsError('主体或 uid 不匹配') };
                        }
                        if (rows.some(function (r) {
                            return r.provider === row.provider && r.identifier === row.identifier;
                        })) {
                            return { data: null, error: dupError() };
                        }
                        row.created_at = row.created_at || new Date().toISOString();
                        rows.push(row);
                        return { data: [Object.assign({}, row)], error: null };
                    }
                    if (table === 'user_bind_ticket') {
                        const subject = subjectOf(sessionHolder.uid);
                        if (row.subject_id !== subject || row.created_by !== sessionHolder.uid) {
                            return { data: null, error: rlsError('票据主体或签发人不匹配') };
                        }
                        row.id = row.id || ('t-' + Math.random().toString(36).slice(2, 10));
                        row.expires_at = row.expires_at || new Date(Date.now() + 600000).toISOString();
                        rows.push(row);
                        return { data: [Object.assign({}, row)], error: null };
                    }
                    return { data: [], error: null };
                }

                if (q.mode === 'update') {
                    if (table === 'user_link') {
                        const list = rows.filter(function (r) { return r.uid === sessionHolder.uid; });
                        const allowed = list.filter(function (r) {
                            const merged = Object.assign({}, r, q.payload);
                            if (merged.subject_id !== merged.uid && !ticketValid(merged.ticket_id, merged.subject_id)) {
                                return false;
                            }
                            return true;
                        });
                        allowed.forEach(function (r) { Object.assign(r, q.payload); });
                        return { data: allowed.map(function (r) { return Object.assign({}, r); }), error: null };
                    }
                    if (table === 'user_credential') {
                        const subject = subjectOf(sessionHolder.uid);
                        const list = rows.filter(function (r) {
                            return r.subject_id === subject || r.uid === sessionHolder.uid;
                        });
                        const allowed = list.filter(function (r) {
                            return Object.assign({}, r, q.payload).subject_id === subjectOf(sessionHolder.uid);
                        });
                        allowed.forEach(function (r) { Object.assign(r, q.payload); });
                        return { data: allowed.map(function (r) { return Object.assign({}, r); }), error: null };
                    }
                    if (table === 'user_bind_ticket') {
                        const subject = subjectOf(sessionHolder.uid);
                        const list = rows.filter(function (r) { return r.subject_id === subject; });
                        list.forEach(function (r) { Object.assign(r, q.payload); });
                        return { data: list.map(function (r) { return Object.assign({}, r); }), error: null };
                    }
                    return { data: [], error: null };
                }

                if (q.mode === 'delete') {
                    let list = rows.slice();
                    if (table === 'user_link') {
                        list = list.filter(function (r) { return r.uid === sessionHolder.uid; });
                    } else {
                        const subject = subjectOf(sessionHolder.uid);
                        list = list.filter(function (r) { return r.subject_id === subject; });
                    }
                    list.forEach(function (r) {
                        const at = rows.indexOf(r);
                        if (at >= 0) rows.splice(at, 1);
                    });
                    return { data: list.map(function (r) { return Object.assign({}, r); }), error: null };
                }

                return { data: [], error: null };
            }

            return api;
        }
        return { from: function (table) { return builder(table); } };
    }

    const originDatabase = mockCloudInner.database;
    mockCloudInner.database = fakeDb();

    global.getApp = function () {
        return {
            ensureSession: async function () {
                return sessionHolder.uid ? { user: { id: sessionHolder.uid } } : null;
            },
            resetSession: function () {},
        };
    };

    const identity = require(path.join(ROOT, 'utils', 'identity.js'));

    // --- 标识归一化 ---
    check('邮箱归一化：去空格并转小写',
        identity.normalize('email', '  Foo@Bar.COM ') === 'foo@bar.com');
    check('非法邮箱归一化为空串', identity.normalize('email', 'not-an-email') === '');
    check('手机号归一化：去掉空格与连字符',
        identity.normalize('phone', '138 0013-8000') === '13800138000');
    check('微信标识原样保留', identity.normalize('wechat', 'wx-abc') === 'wx-abc');

    // --- 唯一键冲突识别 ---
    check('唯一键冲突可识别（错误码 23505）', identity.isUniqueViolation({ code: '23505' }) === true);
    check('唯一键冲突可识别（只有错误文案）',
        identity.isUniqueViolation({ message: 'duplicate key value violates unique constraint' }) === true);
    check('普通权限失败不误判成唯一键冲突',
        identity.isUniqueViolation({ status: 403, message: 'RLS denied' }) === false);

    // --- 主体归属 ---
    sessionHolder.uid = 'uid-A';
    const subjectA = await identity.ensureSubject();
    check('首次进入建立归属行，主体即自己', subjectA.data.subjectId === 'uid-A');
    await identity.ensureSubject();
    check('重复进入不重复建归属行', idb.rows.user_link.length === 1);

    // --- 登录后登记凭据 ---
    const claim1 = await identity.claimAfterLogin('email', '  Foo@Bar.COM ');
    check('登录后首次登记凭据 → status=registered', claim1.data.status === 'registered');
    check('凭据按归一化后的邮箱落库',
        idb.rows.user_credential[0].identifier === 'foo@bar.com');
    const claim2 = await identity.claimAfterLogin('email', 'foo@bar.com');
    check('同一标识再次登录不产生第二条凭据',
        idb.rows.user_credential.length === 1 && claim2.data.status === 'ok');

    // --- 归属冲突：标识已在别的账号下 ---
    idb.rows.user_credential.push({
        provider: 'email',
        identifier: 'taken@x.com',
        subject_id: 'uid-B',
        uid: 'uid-B',
        created_at: new Date().toISOString(),
    });
    sessionHolder.uid = 'uid-C';
    const claim3 = await identity.claimAfterLogin('email', 'taken@x.com');
    check('标识已被别的账号占用 → 判定归属冲突',
        claim3.data.status === 'conflict' && claim3.data.code === 'IDENTIFIER_ALREADY_BOUND');
    const takenRow = idb.rows.user_credential.filter(function (r) {
        return r.identifier === 'taken@x.com';
    })[0];
    check('冲突时原属主体不被改写', takenRow.subject_id === 'uid-B');
    check('冲突时当前 uid 不会被并进别人的主体',
        idb.rows.user_link.filter(function (r) {
            return r.uid === 'uid-C' && r.subject_id === 'uid-B';
        }).length === 0 && subjectOf('uid-C') === 'uid-C');

    // --- 持票据把另一个身份并入主体 ---
    sessionHolder.uid = 'uid-A';
    const ticket = await identity.createTicket();
    check('出票成功且票据带主体', !!ticket.data.id && ticket.data.subjectId === 'uid-A');

    sessionHolder.uid = 'uid-D';
    await identity.ensureSubject();
    await identity.registerCredential('email', 'd@x.com', { uid: 'uid-D', subjectId: 'uid-D' });
    const joined = await identity.joinSubject('uid-A', ticket.data.id, 'email');
    check('持有效票据可把新 uid 并入目标主体',
        !joined.error && joined.data.subjectId === 'uid-A');
    check('并入后归属行主体已改写',
        idb.rows.user_link.filter(function (r) { return r.uid === 'uid-D'; })[0].subject_id === 'uid-A');
    check('合并后两个 uid 落在同一主体',
        subjectOf('uid-A') === 'uid-A' && subjectOf('uid-D') === 'uid-A');

    await identity.syncCredentialSubject('uid-D', 'uid-A');
    check('合并后凭据行挂到新主体',
        idb.rows.user_credential.filter(function (r) { return r.uid === 'uid-D'; })[0].subject_id === 'uid-A');
    check('subjectOf 能读出并入后 uid 所属的主体',
        (await identity.subjectOf('uid-D')) === 'uid-A');
    check('subjectOf 对没有归属行的 uid 返回空串',
        (await identity.subjectOf('uid-nobody')) === '');

    // 归属冲突的判定依据：切换会话后能看出该身份原本属于哪个主体
    sessionHolder.uid = 'uid-H';
    await identity.ensureSubject();
    check('未并入前 subjectOf 返回该身份原属主体',
        (await identity.subjectOf('uid-H')) === 'uid-H');

    // --- 无票据 / 过期票据都必须被拒 ---
    sessionHolder.uid = 'uid-E';
    await identity.ensureSubject();
    const noTicket = await identity.joinSubject('uid-A', null, 'email');
    check('无票据并主体被拒', !!noTicket.error && noTicket.error.code === 'BIND_FAILED');
    check('被拒后归属行未被改写',
        idb.rows.user_link.filter(function (r) { return r.uid === 'uid-E'; })[0].subject_id === 'uid-E');

    sessionHolder.uid = 'uid-F';
    await identity.ensureSubject();
    const ticket2 = await identity.createTicket();
    idb.rows.user_bind_ticket.filter(function (r) { return r.id === ticket2.data.id; })[0].expires_at =
        new Date(Date.now() - 1000).toISOString();
    const expired = await identity.joinSubject('uid-A', ticket2.data.id, 'email');
    check('过期票据不能并主体', !!expired.error);
    check('过期票据不改动归属行',
        idb.rows.user_link.filter(function (r) { return r.uid === 'uid-F'; })[0].subject_id === 'uid-F');

    // --- 票据用掉即失效 ---
    sessionHolder.uid = 'uid-G';
    await identity.ensureSubject();
    const ticket3 = await identity.createTicket();
    await identity.consumeTicket(ticket3.data.id);
    const reused = await identity.joinSubject('uid-A', ticket3.data.id, 'email');
    check('已使用的票据不能再并主体', !!reused.error);

    mockCloudInner.database = originDatabase;

    console.log('[11/11] 登录页单一入口：账号状态自动检测');

    // 用可控的 auth mock 跑真实 login-panel 配置：
    // 已注册 → 直接登录；账号不存在 → 自动展开验证码注册；密码错 → 不误发验证码。
    const panelPath = path.join(ROOT, 'components', 'login-panel', 'login-panel.js');
    delete require.cache[panelPath];
    let panelConfig = null;
    global.Component = function (options) { panelConfig = options; };
    global.wx = {
        showToast: function () {},
        showModal: function () {},
        navigateTo: function () {},
        setStorageSync: function () {},
        getStorageSync: function () { return ''; },
    };

    const savedAuth = {
        signInWithPassword: mockCloudInner.auth.signInWithPassword,
        sendOtp: mockCloudInner.auth.sendOtp,
        verifyOtp: mockCloudInner.auth.verifyOtp,
    };
    let scenario = 'existing';   // existing | new | wrong-password
    let otpCalls = 0;
    let verifyCalls = 0;
    mockCloudInner.auth.signInWithPassword = async function () {
        if (scenario === 'existing') return { data: { user: { id: 'u1' } }, error: null };
        if (scenario === 'new') {
            return { data: null, error: { kind: 'not-found', message: 'user not found', status: 404 } };
        }
        return { data: null, error: { kind: 'unauthenticated', message: 'invalid password', status: 401 } };
    };
    mockCloudInner.auth.sendOtp = async function () {
        otpCalls += 1;
        return { data: { verificationId: 'v1', isExistingUser: scenario === 'existing' }, error: null };
    };
    mockCloudInner.auth.verifyOtp = async function () {
        verifyCalls += 1;
        return { data: { user: { id: 'u2' } }, error: null };
    };

    require(panelPath);

    function makePanel() {
        const p = Object.create(panelConfig.methods);
        p.data = JSON.parse(JSON.stringify(panelConfig.data));
        p.properties = { agreed: true };
        p.events = [];
        p.setData = function (patch) { Object.assign(this.data, patch); };
        p.triggerEvent = function (name, detail) { this.events.push({ name: name, detail: detail }); };
        p.alive = true;
        // 主体补账需要真实会话，这里只验登录状态机，跳过
        p.claimIdentity = async function () { return null; };
        return p;
    }
    function fill(p, extra) {
        Object.assign(p.data, {
            account: 'test@example.com',
            password: '123456',
            confirmPassword: '123456',
            code: '654321',
        }, extra || {});
        return p;
    }
    function done(p) { p.stopCountdown(); }

    // 1. 已注册 → 一次登录成功，不展开注册、不发验证码
    scenario = 'existing';
    otpCalls = 0;
    let p1 = fill(makePanel());
    await p1.submit();
    check('已注册账号 → 直接登录，不展开注册区',
        p1.events.length === 1 && p1.events[0].name === 'signedin' && p1.data.signup === false);
    check('已注册账号 → 不发送多余验证码', otpCalls === 0, '实际 ' + otpCalls);
    done(p1);

    // 2. 账号不存在 → 自动检测并展开注册区，自动发一次验证码
    scenario = 'new';
    otpCalls = 0;
    let p2 = fill(makePanel());
    await p2.submit();
    check('账号不存在 → 自动展开验证码注册区',
        p2.data.signup === true && p2.data.submitText === '创建并登录');
    check('自动展开时发了 1 次验证码', otpCalls === 1, '实际 ' + otpCalls);
    check('自动展开时未触发 signedin', p2.events.length === 0);
    check('自动展开后页内提示说明未注册', /未注册/.test(p2.data.tip));
    done(p2);

    // 3. 密码错 → 不误判为未注册，不发验证码，只给错误
    scenario = 'wrong-password';
    otpCalls = 0;
    let p3 = fill(makePanel());
    await p3.submit();
    check('密码不正确 → 不展开注册区', p3.data.signup === false);
    check('密码不正确 → 不误发验证码', otpCalls === 0, '实际 ' + otpCalls);
    check('密码不正确 → 页内有错误提示', !!p3.data.error);
    done(p3);

    // 4. 手动「没有账号？注册」入口同样可展开
    scenario = 'new';
    let p4 = fill(makePanel());
    await p4.onOpenSignup();
    check('手动注册入口也能展开注册区', p4.data.signup === true && !!p4.challenge);
    done(p4);

    // 5. sendOtp 复核为「已注册」→ 收起注册区并提示（不误建号）
    scenario = 'existing';
    let p5 = fill(makePanel());
    await p5.onOpenSignup();
    check('sendOtp 返回已注册 → 收起注册区', p5.data.signup === false);
    check('sendOtp 返回已注册 → 给出密码提示', /已注册/.test(p5.data.error));
    done(p5);

    // 6. 注册区两次密码不一致 → 拒绝提交
    scenario = 'new';
    verifyCalls = 0;
    let p6 = fill(makePanel(), { confirmPassword: 'different' });
    await p6.onOpenSignup();
    await p6.submit();
    check('注册时两次密码不一致 → 拒绝', /不一致/.test(p6.data.error) && verifyCalls === 0);
    done(p6);

    // 7. 注册区填全 → verifyOtp 建号并登录
    scenario = 'new';
    verifyCalls = 0;
    let p7 = fill(makePanel());
    await p7.onOpenSignup();
    await p7.submit();
    check('注册区填全 → verifyOtp 建号并登录',
        verifyCalls === 1 && p7.events.length === 1 && p7.events[0].name === 'signedin');
    check('注册成功不带 needPassword', p7.events[0].detail.needPassword === false);
    done(p7);

    // 8. 协议门禁仍然生效
    let p8 = fill(makePanel());
    p8.properties.agreed = false;
    await p8.submit();
    check('未勾选协议 → 拒绝提交且不发请求', /同意/.test(p8.data.error) && p8.events.length === 0);
    done(p8);

    mockCloudInner.auth.signInWithPassword = savedAuth.signInWithPassword;
    mockCloudInner.auth.sendOtp = savedAuth.sendOtp;
    mockCloudInner.auth.verifyOtp = savedAuth.verifyOtp;

    console.log('');
    console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
    if (fail) process.exit(1);
}

main().catch(function (error) {
    console.error('运行异常：', error);
    process.exit(1);
});
