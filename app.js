const { cloud } = require('./utils/cloud');
const store = require('./utils/store');

/**
 * 取 auth 方法并绑定 this。
 * 云端 SDK 在不同构建/版本里暴露的能力可能不同（例如 WorkBuddy 账号回调），
 * 缺失时返回 null，由调用方跳过，避免 App 生命周期直接抛异常导致白屏。
 */
function authMethod(name) {
    const auth = cloud && cloud.auth;
    if (!auth || typeof auth[name] !== 'function') return null;
    return auth[name].bind(auth);
}

/** SDK 的返回统一是 { data, error }；未登录时 data 为 null，必须归为 null */
function sessionOf(result) {
    if (!result || result.error) return null;
    const data = result.data !== undefined ? result.data : result;
    if (!data || data.error) return null;
    return data;
}

App({
    globalData: {
        appName: '个人信息管家',
        sessionPromise: null,
    },

    onLaunch() {
        const getSession = authMethod('getSession');
        this.sessionPromise = getSession
            ? Promise.resolve(getSession())
                .then(function (result) {
                    const session = sessionOf(result);
                    store.setOwnerName((session && session.user && session.user.name) || null);
                    return session;
                })
                .catch(function () {
                    store.setOwnerName(null);
                    return null;
                })
            : Promise.resolve(null);
        this.registerAuthListener();
    },

    /** 监听 SDK 会话变化，登出 / 改密 / 换号时清掉应用内会话缓存 */
    registerAuthListener() {
        if (this.authListenerRegistered) return;
        const onAuthStateChange = authMethod('onAuthStateChange');
        if (!onAuthStateChange) return;
        try {
            onAuthStateChange(function (eventName) {
                if (eventName === 'SIGNED_OUT' || eventName === 'SIGNED_IN' ||
                    eventName === 'PASSWORD_RECOVERY' || eventName === 'USER_UPDATED' ||
                    eventName === 'TOKEN_REFRESHED') {
                    this.resetSession();
                }
            }.bind(this));
            this.authListenerRegistered = true;
        } catch (error) {
            // SDK 不支持监听时，仍保留各页手动 resetSession 的兜底
        }
    },

    onShow(options) {
        if (this.workBuddyAuthReady) return;

        // 本应用使用账号密码登录，不依赖 WorkBuddy 账号回调。
        // SDK 未提供该方法时直接跳过，不影响登录链路。
        const handle = authMethod('handleWorkBuddyMiniProgramCallback');
        const getSession = authMethod('getSession');
        if (!handle || !getSession) {
            this.workBuddyAuthReady = Promise.resolve(null);
            return;
        }

        this.workBuddyAuthReady = Promise.resolve(handle(options))
            .then(function (cb) {
                if (cb && cb.error) return cb;
                return getSession();
            })
            .then(function (result) {
                const session = sessionOf(result);
                if (session && session.user) store.setOwnerName(session.user.name || null);
                return session;
            })
            .catch(function () {
                return null;
            });
    },

    /** 获取会话（带缓存） */
    ensureSession() {
        if (!this.sessionPromise) {
            const getSession = authMethod('getSession');
            this.sessionPromise = getSession
                ? Promise.resolve(getSession()).then(sessionOf).catch(function () { return null; })
                : Promise.resolve(null);
        }
        return this.sessionPromise;
    },

    /** 登录/退出后重置会话缓存 */
    resetSession() {
        this.sessionPromise = null;
    },
});
