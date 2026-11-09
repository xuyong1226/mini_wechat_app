/**
 * 微信登录与账号类型判定。
 *
 * 官方规则（cloud-service / auth / code-generation.md）：
 * - wx.login 取 code → cloud.auth.signInWithWechat(code, appid)
 * - appid 必须运行时从 wx.getAccountInfoSync().miniProgram.appId 取；
 *   不硬编码、不用 WorkBuddy applicationId（wbapp_…）代替
 * - 不实现 jscode2session、不收 AppSecret、不把 openid 当自己的认证凭据
 * - 日志只记 stage / message，不记 code、session、原始 error 对象
 * - H5 预览拿不到真实 code，需在微信内验证
 */

const { cloud } = require('./cloud');

const PROVIDER_KEY = 'login_provider';
const NOTICE_KEY = 'wechat_notice_shown';

function logStage(stage, message) {
    try {
        console.error('[WorkBuddy Cloud] login failed', JSON.stringify({
            stage: stage,
            message: String(message || '').slice(0, 200),
        }));
    } catch (error) {
        // 日志失败不影响登录链路
    }
}

function getRuntimeAppId() {
    try {
        if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') return '';
        const info = wx.getAccountInfoSync();
        const appid = info && info.miniProgram && info.miniProgram.appId;
        // 未绑定小程序 / 游客态：不要拿占位 appid 去换 session
        if (!appid || appid === 'touristappid') return '';
        return appid;
    } catch (error) {
        return '';
    }
}

function getLoginCode() {
    return new Promise(function (resolve) {
        if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
            resolve('');
            return;
        }
        try {
            wx.login({
                success: function (res) {
                    resolve(res && res.code ? res.code : '');
                },
                fail: function (error) {
                    logStage('wx.login', error && error.errMsg ? error.errMsg : 'wx.login failed');
                    resolve('');
                },
            });
        } catch (error) {
            logStage('wx.login', error && error.message ? error.message : 'wx.login exception');
            resolve('');
        }
    });
}

/** 微信登录主流程；统一返回 { data, error }，调用方只需处理 error.message */
async function signIn() {
    const appid = getRuntimeAppId();
    if (!appid) {
        return { data: null, error: { message: '当前环境未绑定小程序，请在微信内打开体验版或正式版' } };
    }
    const code = await getLoginCode();
    if (!code) {
        return { data: null, error: { message: '微信登录未取到凭证，请在微信内重试' } };
    }

    const auth = cloud && cloud.auth;
    if (!auth || typeof auth.signInWithWechat !== 'function') {
        return { data: null, error: { message: '当前版本不支持微信登录，请使用账号密码登录' } };
    }

    let result;
    try {
        result = await auth.signInWithWechat(code, appid);
    } catch (error) {
        logStage('wechat-login-handler', error && error.message ? error.message : 'signInWithWechat exception');
        return { data: null, error: { message: '微信登录失败，请重试' } };
    }
    if (!result || result.error) {
        const message = result && result.error && result.error.message;
        return { data: null, error: { message: message || '微信登录失败，请重试' } };
    }
    return { data: result.data || null, error: null };
}

/** 记住本次登录方式（展示用，不参与鉴权） */
function markProvider(kind) {
    try {
        if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
            wx.setStorageSync(PROVIDER_KEY, kind === 'wechat' ? 'wechat' : 'password');
        }
    } catch (error) {
        // 存储失败不影响登录
    }
}

/**
 * 账号类型：优先读会话 JWT 原始 payload 的 provider，其次读本地登录方式标记。
 * 仅用于界面展示与「改密码」入口是否可用，不作为权限判断依据。
 */
function accountType(session) {
    const raw = session && session.user && session.user.raw;
    if (raw) {
        const provider = raw.provider || raw.providers ||
            (raw.app_metadata && raw.app_metadata.provider) || '';
        if (String(provider).indexOf('wechat') >= 0) return 'wechat';
    }
    try {
        if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
            if (wx.getStorageSync(PROVIDER_KEY) === 'wechat') return 'wechat';
        }
    } catch (error) {
        // 读不到标记时按密码账号处理
    }
    return 'password';
}

/** 首次微信登录的一次性提示标记 */
function shouldShowWechatNotice() {
    try {
        return wx.getStorageSync(NOTICE_KEY) !== 1;
    } catch (error) {
        return true;
    }
}

function markWechatNoticeShown() {
    try {
        wx.setStorageSync(NOTICE_KEY, 1);
    } catch (error) {
        // 存储失败时下次再提示，不影响登录
    }
}

module.exports = {
    signIn: signIn,
    markProvider: markProvider,
    accountType: accountType,
    shouldShowWechatNotice: shouldShowWechatNotice,
    markWechatNoticeShown: markWechatNoticeShown,
};
