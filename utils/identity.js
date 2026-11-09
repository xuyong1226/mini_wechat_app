/**
 * 统一用户主体（subject）与登录凭据（credential）。
 *
 * 背景：云端 auth 的 uid（JWT sub）由登录方式决定 —— 邮箱登录一个 uid、手机登录一个 uid、
 * 微信登录又是一个 uid。不改这一点，同一个人用三种方式登录就是三个互不相通的账号。
 *
 * 模型（表结构见 sql/01_identity_tables.sql）：
 *   user_link        uid  -> subject_id     多对一，把多个 uid 归并成一个「主体」
 *   user_credential  (provider, identifier) -> subject_id + uid
 *                    主键 (provider, identifier) 保证「同一登录标识只能属于一个主体」
 *   user_bind_ticket 一次性授权票据，证明「并入某主体」是主体本人授权的
 *
 * 业务表 owner_id 的比较口径改用 current_subject_scope()（本主体下所有 uid），
 * 所以合并前后创建的数据都还在，不需要挪数据。
 *
 * 约定：
 * - 所有函数都返回 { data, error } / { ok, code }，不抛异常给页面，登录链路永远不被这层拖垮；
 * - 冲突不自动合并：同一标识已在别的账号下，只报告 IDENTIFIER_ALREADY_BOUND，
 *   由用户在「账号与安全」里显式确认合并，避免把两个人的数据并到一起；
 * - 日志只记阶段与错误码，不记 identifier 原文。
 */

const { cloud } = require('./cloud');

const PROVIDER_EMAIL = 'email';
const PROVIDER_PHONE = 'phone';
const PROVIDER_WECHAT = 'wechat';

const LINK_COLUMNS = 'uid,subject_id,via,ticket_id,created_at';
const CREDENTIAL_COLUMNS = 'provider,identifier,subject_id,uid,created_at';
const TICKET_COLUMNS = 'id,subject_id,created_by,expires_at,used_at';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9][0-9\s-]{5,19}$/;

const CODE = {
    NOT_SIGNED_IN: 'NOT_SIGNED_IN',
    IDENTIFIER_ALREADY_BOUND: 'IDENTIFIER_ALREADY_BOUND',
    INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
    TICKET_UNAVAILABLE: 'TICKET_UNAVAILABLE',
    BIND_FAILED: 'BIND_FAILED',
    CLIENT_EXCEPTION: 'CLIENT_EXCEPTION',
};

function table(name) {
    return cloud.database.from(name);
}

function rowsOf(result) {
    return result && Array.isArray(result.data) ? result.data : [];
}

function fail(code, message) {
    return { data: null, error: { code: code, message: message || '' } };
}

function logStage(stage, code) {
    try {
        console.error('[identity]', JSON.stringify({ stage: stage, code: code || '' }));
    } catch (error) {
        // 日志失败不影响业务
    }
}

/** 归一化登录标识；不合法的返回空串 */
function normalize(provider, value) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!text) return '';
    if (provider === PROVIDER_EMAIL) return EMAIL_RE.test(text) ? text.toLowerCase() : '';
    if (provider === PROVIDER_PHONE) {
        if (!PHONE_RE.test(text)) return '';
        // 去掉空格、连字符、括号，保留前导 +，让同一号码只有一种写法
        return text.replace(/[\s\-()]/g, '');
    }
    if (provider === PROVIDER_WECHAT) return text;
    return '';
}

function providerLabel(provider) {
    if (provider === PROVIDER_EMAIL) return '邮箱';
    if (provider === PROVIDER_PHONE) return '手机号';
    if (provider === PROVIDER_WECHAT) return '微信';
    return '账号';
}

/** 唯一键冲突（主键/unique 违反）：云端会以 409 + 23505 返回，字段位置可能不同，逐个兜 */
function isUniqueViolation(error) {
    if (!error) return false;
    const code = String(error.code || (error.cause && error.cause.code) || '');
    if (code === '23505' || code === 'DATABASE_23505') return true;
    const message = String(error.message || (error.cause && error.cause.message) || '');
    if (/duplicate key|unique constraint|already exists/i.test(message)) return true;
    return Number(error.status) === 409;
}

/** 当前会话的 uid；未登录返回空串 */
async function currentUid() {
    try {
        const app = typeof getApp === 'function' ? getApp() : null;
        if (!app || typeof app.ensureSession !== 'function') return '';
        const session = await app.ensureSession();
        const user = session && session.user;
        return user && user.id ? String(user.id) : '';
    } catch (error) {
        return '';
    }
}

/**
 * 确保当前 uid 在 user_link 里有归属行，返回主体 id。
 * 没有行就插一行 subject_id = uid（自己就是主体），失败则回落到 uid。
 */
async function ensureSubject() {
    const uid = await currentUid();
    if (!uid) return fail(CODE.NOT_SIGNED_IN, '请先登录');

    let listed;
    try {
        listed = await table('user_link').select(LINK_COLUMNS).eq('uid', uid);
    } catch (error) {
        listed = { data: null, error: { message: '' } };
    }
    const mine = rowsOf(listed).filter(function (row) { return row && row.uid === uid; })[0];
    if (mine && mine.subject_id) {
        return { data: { uid: uid, subjectId: mine.subject_id, created: false }, error: null };
    }

    let created;
    try {
        created = await table('user_link')
            .insert({ uid: uid, subject_id: uid, via: 'self' })
            .select(LINK_COLUMNS);
    } catch (error) {
        created = { data: null, error: { message: '' } };
    }
    if (created && !created.error) {
        return { data: { uid: uid, subjectId: uid, created: true }, error: null };
    }

    // 并发下可能已经被另一个请求插入，重新读一次
    let retry;
    try {
        retry = await table('user_link').select(LINK_COLUMNS).eq('uid', uid);
    } catch (error) {
        retry = { data: null, error: { message: '' } };
    }
    const again = rowsOf(retry).filter(function (row) { return row && row.uid === uid; })[0];
    if (again && again.subject_id) {
        return { data: { uid: uid, subjectId: again.subject_id, created: false }, error: null };
    }
    logStage('ensure-subject', created && created.error ? created.error.code : 'unknown');
    return { data: { uid: uid, subjectId: uid, created: false }, error: null };
}

/** 本主体下的全部登录凭据（RLS 只放行自己主体的行） */
async function listCredentials() {
    let result;
    try {
        result = await table('user_credential')
            .select(CREDENTIAL_COLUMNS)
            .order('created_at', { ascending: true });
    } catch (error) {
        return { data: [], error: { code: CODE.CLIENT_EXCEPTION, message: '' } };
    }
    if (result && result.error) {
        return { data: [], error: result.error };
    }
    const rows = rowsOf(result).map(function (row) {
        return {
            provider: row.provider,
            identifier: row.identifier,
            subjectId: row.subject_id,
            uid: row.uid,
        };
    });
    return { data: rows, error: null };
}

/** 查某个标识是否已登记在本主体下；别的主体的行被 RLS 挡住，查不到属正常 */
async function findCredential(provider, identifier) {
    const normalized = normalize(provider, identifier);
    if (!normalized) return { data: null, error: null };
    let result;
    try {
        result = await table('user_credential')
            .select(CREDENTIAL_COLUMNS)
            .eq('provider', provider)
            .eq('identifier', normalized);
    } catch (error) {
        return { data: null, error: null };
    }
    const row = rowsOf(result)[0];
    if (!row) return { data: null, error: null };
    return {
        data: { provider: row.provider, identifier: row.identifier, subjectId: row.subject_id, uid: row.uid },
        error: null,
    };
}

/**
 * 把标识登记到「当前会话 uid 所属的主体」。
 * 主键冲突 = 这个标识已经在别的账号下，返回 IDENTIFIER_ALREADY_BOUND，绝不静默改归属。
 */
async function registerCredential(provider, identifier, context) {
    const normalized = normalize(provider, identifier);
    if (!normalized) return fail(CODE.INVALID_IDENTIFIER, '账号格式不正确');

    const ctx = context || {};
    const uid = ctx.uid || (await currentUid());
    if (!uid) return fail(CODE.NOT_SIGNED_IN, '请先登录');
    let subjectId = ctx.subjectId || '';
    if (!subjectId) {
        const subject = await ensureSubject();
        if (subject.error || !subject.data) return fail(CODE.NOT_SIGNED_IN, '请先登录');
        subjectId = subject.data.subjectId;
    }

    const existing = await findCredential(provider, normalized);
    if (existing.data) {
        // 已经是自己的：幂等返回，不重复写
        if (existing.data.subjectId === subjectId) {
            return { data: Object.assign({ created: false }, existing.data), error: null };
        }
        return fail(CODE.IDENTIFIER_ALREADY_BOUND, providerLabel(provider) + '已绑定到另一个账号');
    }

    let result;
    try {
        result = await table('user_credential')
            .insert({
                provider: provider,
                identifier: normalized,
                subject_id: subjectId,
                uid: uid,
            })
            .select(CREDENTIAL_COLUMNS);
    } catch (error) {
        result = { data: null, error: error };
    }

    if (result && !result.error) {
        return {
            data: {
                provider: provider,
                identifier: normalized,
                subjectId: subjectId,
                uid: uid,
                created: true,
            },
            error: null,
        };
    }
    if (isUniqueViolation(result && result.error)) {
        logStage('register-credential', CODE.IDENTIFIER_ALREADY_BOUND);
        return fail(CODE.IDENTIFIER_ALREADY_BOUND, providerLabel(provider) + '已绑定到另一个账号');
    }
    logStage('register-credential', result && result.error ? result.error.code : 'unknown');
    return { data: null, error: result ? result.error : { message: '' } };
}

/** 出票：允许把某个 uid 并入当前主体。票据 10 分钟有效、一次性。 */
async function createTicket() {
    const subject = await ensureSubject();
    if (subject.error) return subject;
    const uid = subject.data.uid;
    const subjectId = subject.data.subjectId;

    let result;
    try {
        result = await table('user_bind_ticket')
            .insert({ subject_id: subjectId, created_by: uid })
            .select(TICKET_COLUMNS);
    } catch (error) {
        result = { data: null, error: error };
    }
    const row = rowsOf(result)[0];
    if (!result || result.error || !row || !row.id) {
        logStage('create-ticket', result && result.error ? result.error.code : 'no-row');
        return fail(CODE.TICKET_UNAVAILABLE, '绑定凭证生成失败，请重试');
    }
    return {
        data: { id: row.id, subjectId: subjectId, expiresAt: row.expires_at, uid: uid },
        error: null,
    };
}

/**
 * 某个 uid 当前所属的主体。
 * 读自己那一行（RLS 允许 uid = auth.uid() 可见）；没有归属行时返回空串，
 * 与「归属到自己」区分开 —— 前者是从没登录过，后者是独立账号。
 */
async function subjectOf(uid) {
    const target = uid || (await currentUid());
    if (!target) return '';
    let listed;
    try {
        listed = await table('user_link').select(LINK_COLUMNS).eq('uid', target);
    } catch (error) {
        return '';
    }
    const row = rowsOf(listed).filter(function (r) { return r && r.uid === target; })[0];
    return row && row.subject_id ? row.subject_id : '';
}

/** 把「当前会话 uid」并入指定主体；已有归属行则改写（改 subject_id 需要票据，策略层校验） */
async function joinSubject(subjectId, ticketId, via) {
    const uid = await currentUid();
    if (!uid) return fail(CODE.NOT_SIGNED_IN, '请先登录');
    if (!subjectId) return fail(CODE.BIND_FAILED, '缺少目标账号');

    const payload = { uid: uid, subject_id: subjectId, via: via || 'bind', ticket_id: ticketId || null };

    let inserted;
    try {
        inserted = await table('user_link').insert(payload).select(LINK_COLUMNS);
    } catch (error) {
        inserted = { data: null, error: error };
    }
    if (inserted && !inserted.error) {
        return { data: { uid: uid, subjectId: subjectId }, error: null };
    }

    // uid 是主键：已存在归属行时改这一行
    let updated;
    try {
        updated = await table('user_link')
            .update(payload)
            .eq('uid', uid)
            .select(LINK_COLUMNS);
    } catch (error) {
        updated = { data: null, error: error };
    }
    const row = rowsOf(updated)[0];
    if (row && row.subject_id === subjectId) {
        return { data: { uid: uid, subjectId: subjectId }, error: null };
    }
    logStage('join-subject', (updated && updated.error && updated.error.code) || 'no-row');
    return fail(CODE.BIND_FAILED, '绑定未完成，请重试');
}

/** 合并后把该 uid 名下的凭据行挂到新主体，否则「已绑定」列表会少行 */
async function syncCredentialSubject(uid, subjectId) {
    if (!uid || !subjectId) return { data: null, error: null };
    let result;
    try {
        result = await table('user_credential')
            .update({ subject_id: subjectId })
            .eq('uid', uid);
    } catch (error) {
        result = { data: null, error: error };
    }
    return { data: rowsOf(result).length, error: result ? result.error : null };
}

/** 票据用掉后立即置 used_at，防止十分钟内被重放 */
async function consumeTicket(ticketId) {
    if (!ticketId) return { data: null, error: null };
    let result;
    try {
        result = await table('user_bind_ticket')
            .update({ used_at: new Date().toISOString() })
            .eq('id', ticketId);
    } catch (error) {
        result = { data: null, error: error };
    }
    return { data: null, error: result ? result.error : null };
}

/**
 * 登录成功后调用：确认当前 uid 的归属，并把本次登录用的标识登记进来。
 * 永不阻断登录 —— 失败只返回 status，由页面决定是否提示。
 *
 * status:
 *   ok          标识已在本主体下
 *   registered  本次首次登记
 *   conflict    标识已属于另一个主体，未做任何合并
 *   skipped     非标准标识或未登录
 */
async function claimAfterLogin(provider, identifier) {
    const normalized = normalize(provider, identifier);
    if (!normalized) return { data: { status: 'skipped' }, error: null };

    const subject = await ensureSubject();
    if (subject.error) return { data: { status: 'skipped' }, error: null };
    const ctx = { uid: subject.data.uid, subjectId: subject.data.subjectId };

    const registered = await registerCredential(provider, normalized, ctx);
    if (!registered.error) {
        return {
            data: {
                status: registered.data && registered.data.created ? 'registered' : 'ok',
                subjectId: ctx.subjectId,
                uid: ctx.uid,
                provider: provider,
                identifier: normalized,
            },
            error: null,
        };
    }
    if (registered.error.code === CODE.IDENTIFIER_ALREADY_BOUND) {
        return {
            data: {
                status: 'conflict',
                code: CODE.IDENTIFIER_ALREADY_BOUND,
                subjectId: ctx.subjectId,
                uid: ctx.uid,
                provider: provider,
                identifier: normalized,
            },
            error: null,
        };
    }
    return { data: { status: 'skipped', subjectId: ctx.subjectId, uid: ctx.uid }, error: null };
}

module.exports = {
    PROVIDER_EMAIL: PROVIDER_EMAIL,
    PROVIDER_PHONE: PROVIDER_PHONE,
    PROVIDER_WECHAT: PROVIDER_WECHAT,
    CODE: CODE,
    normalize: normalize,
    providerLabel: providerLabel,
    isUniqueViolation: isUniqueViolation,
    currentUid: currentUid,
    ensureSubject: ensureSubject,
    subjectOf: subjectOf,
    listCredentials: listCredentials,
    findCredential: findCredential,
    registerCredential: registerCredential,
    createTicket: createTicket,
    joinSubject: joinSubject,
    syncCredentialSubject: syncCredentialSubject,
    consumeTicket: consumeTicket,
    claimAfterLogin: claimAfterLogin,
};
