// 绑定登录方式：把一个新凭据（微信 / 邮箱 / 手机号）并到当前用户主体上。
//
// 关键约束：云端 SDK 没有「给已有用户追加邮箱」的接口，验证任一凭据都会换来一个新 uid。
// 所以流程固定为：先在原主体出票 -> 验证凭据（会话切到新 uid）-> 用票据把新 uid 并入原主体。
// 原账号的数据不会动，新 uid 落进来后按主体口径共享同一份数据。
//
// 失败处理：验证成功后若并主体失败，会话已经切到新 uid，页面保留票据并提供「重试绑定」，
// 不做任何数据合并，也不会把两张票混用。

const { cloud } = require('../../utils/cloud');
const guard = require('../../utils/auth-guard');
const identity = require('../../utils/identity');
const wechatAuth = require('../../utils/wechat-auth');
const { maskAccount } = require('../../utils/avatars');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9][0-9\s-]{5,19}$/;
const MIN_PASSWORD_LENGTH = 6;
const COUNTDOWN_SECONDS = 60;
const JOIN_RETRY = 3;

function providerMeta(provider) {
    if (provider === identity.PROVIDER_WECHAT) {
        return {
            title: '绑定微信',
            desc: '绑定后可用微信一键登录，与当前账号看到同一份数据。',
            inputLabel: '',
            placeholder: '',
        };
    }
    if (provider === identity.PROVIDER_PHONE) {
        return {
            title: '绑定手机号',
            desc: '绑定后可用手机号 + 密码登录，与当前账号看到同一份数据。',
            inputLabel: '手机号',
            placeholder: '请输入手机号',
        };
    }
    return {
        title: '绑定邮箱',
        desc: '绑定后可用邮箱 + 密码登录，与当前账号看到同一份数据。',
        inputLabel: '邮箱',
        placeholder: '请输入邮箱地址',
    };
}

function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

Page({
    data: {
        provider: identity.PROVIDER_EMAIL,
        title: '',
        desc: '',
        inputLabel: '',
        placeholder: '',
        identifier: '',
        code: '',
        password: '',
        needPassword: false,
        codeSent: false,
        sending: false,
        submitting: false,
        countdown: 0,
        bound: false,
        boundText: '',
        pending: false,
        conflict: false,
        tip: '',
        error: '',
    },

    onLoad(options) {
        const raw = (options && options.provider) || identity.PROVIDER_EMAIL;
        const provider = [identity.PROVIDER_EMAIL, identity.PROVIDER_PHONE, identity.PROVIDER_WECHAT]
            .indexOf(raw) >= 0 ? raw : identity.PROVIDER_EMAIL;
        const meta = providerMeta(provider);
        this.setData(Object.assign({ provider: provider }, meta));
        wx.setNavigationBarTitle({ title: meta.title });
        this.loadState();
    },

    onShow() {
        this.alive = true;
    },

    onHide() {
        this.alive = false;
        this.stopCountdown();
    },

    onUnload() {
        this.alive = false;
        this.stopCountdown();
    },

    /** 已绑定就把按钮换成「已绑定」，避免同一凭据重复登记 */
    async loadState() {
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ submitting: false, error: '登录状态已失效，请重新登录' });
            guard.goLogin();
            return;
        }
        const subject = await identity.ensureSubject();
        if (subject.error) {
            guard.goLogin();
            return;
        }
        this.oldUid = subject.data.uid;
        this.subjectId = subject.data.subjectId;

        const listed = await identity.listCredentials();
        const hit = (listed.data || []).filter(function (row) {
            return row.provider === this.data.provider;
        }.bind(this))[0];
        if (hit) {
            this.setData({
                bound: true,
                boundText: maskAccount(hit.identifier) || hit.identifier,
            });
        }
    },

    onIdentifierInput(event) {
        this.setData({ identifier: event.detail.value, error: '', tip: '' });
    },

    onCodeInput(event) {
        this.setData({ code: event.detail.value, error: '' });
    },

    onPasswordInput(event) {
        this.setData({ password: event.detail.value, error: '' });
    },

    /** 校验输入并返回归一化后的标识；不合法时写 error 并返回空串 */
    readIdentifier() {
        const provider = this.data.provider;
        const value = (this.data.identifier || '').trim();
        if (!value) {
            this.setData({ error: '请输入' + (provider === identity.PROVIDER_PHONE ? '手机号' : '邮箱地址') });
            return '';
        }
        if (provider === identity.PROVIDER_EMAIL && !EMAIL_RE.test(value)) {
            this.setData({ error: '邮箱格式不正确' });
            return '';
        }
        if (provider === identity.PROVIDER_PHONE && !PHONE_RE.test(value)) {
            this.setData({ error: '手机号格式不正确' });
            return '';
        }
        const normalized = identity.normalize(provider, value);
        if (!normalized) {
            this.setData({ error: '账号格式不正确' });
            return '';
        }
        return normalized;
    },

    /** 发验证码；新账号需要用户同时设一个密码 */
    async onSendCode() {
        if (this.data.sending || this.data.countdown > 0) return;
        const provider = this.data.provider;
        const identifier = this.readIdentifier();
        if (!identifier) return;

        this.setData({ sending: true, error: '', tip: '' });
        const payload = provider === identity.PROVIDER_PHONE
            ? { phone: identifier }
            : { email: identifier };
        let sent;
        try {
            sent = await cloud.auth.sendOtp(payload);
        } catch (error) {
            sent = { data: null, error: { message: '' } };
        }
        if (this.alive === false) return;
        this.setData({ sending: false });
        if (!sent || sent.error) {
            this.setData({ error: (sent && sent.error && sent.error.message) || '验证码发送失败，请重试' });
            return;
        }
        const data = sent.data || {};
        this.challenge = {
            identifier: identifier,
            verificationId: data.verificationId,
            isExistingUser: !!data.isExistingUser,
        };
        this.setData({
            codeSent: true,
            needPassword: !data.isExistingUser,
            tip: data.isExistingUser ? '验证码已发送，请查收' : '验证码已发送；该账号尚未注册，绑定时会用下面的密码开通',
            countdown: COUNTDOWN_SECONDS,
        });
        this.startCountdown();
    },

    /**
     * 邮箱 / 手机号绑定：出票 -> 验码（换会话）-> 并主体 -> 登记凭据
     */
    async onConfirmCode() {
        if (this.data.submitting) return;
        if (!this.challenge) {
            this.setData({ error: '请先获取验证码' });
            return;
        }
        const code = (this.data.code || '').trim();
        if (!code) {
            this.setData({ error: '请输入验证码' });
            return;
        }
        const password = this.data.password || '';
        if (this.data.needPassword && password.length < MIN_PASSWORD_LENGTH) {
            this.setData({ error: '密码至少 ' + MIN_PASSWORD_LENGTH + ' 位' });
            return;
        }

        this.setData({ submitting: true, error: '', tip: '正在绑定…' });
        const ticket = await identity.createTicket();
        if (ticket.error) {
            this.setData({ submitting: false, tip: '', error: ticket.error.message || '绑定凭证生成失败，请重试' });
            return;
        }
        this.pendingTicket = ticket.data;

        const provider = this.data.provider;
        const payload = provider === identity.PROVIDER_PHONE
            ? { phone: this.challenge.identifier }
            : { email: this.challenge.identifier };
        payload.verificationId = this.challenge.verificationId;
        payload.isExistingUser = this.challenge.isExistingUser;
        payload.token = code;
        if (!this.challenge.isExistingUser) payload.password = password;

        let verified;
        try {
            verified = await cloud.auth.verifyOtp(payload);
        } catch (error) {
            verified = { data: null, error: { message: '' } };
        }
        if (this.alive === false) return;
        if (!verified || verified.error) {
            this.setData({
                submitting: false,
                tip: '',
                error: (verified && verified.error && verified.error.message) || '验证码不正确或已过期',
            });
            return;
        }
        // 从这一步起会话已经换成新 uid，原主体信息只在 pendingTicket 里
        getApp().resetSession();
        await this.finishBind(ticket.data.subjectId, ticket.data.id, this.challenge.identifier);
    },

    /** 微信绑定：出票 -> 微信授权（换会话）-> 并主体 */
    async onBindWechat() {
        if (this.data.submitting) return;
        this.setData({ submitting: true, error: '', tip: '正在唤起微信…' });

        const ticket = await identity.createTicket();
        if (ticket.error) {
            this.setData({ submitting: false, tip: '', error: ticket.error.message || '绑定凭证生成失败，请重试' });
            return;
        }
        this.pendingTicket = ticket.data;

        const result = await wechatAuth.signIn();
        if (this.alive === false) return;
        if (result.error) {
            this.setData({ submitting: false, tip: '', error: result.error.message || '微信授权失败，请重试' });
            return;
        }
        getApp().resetSession();
        const uid = await identity.currentUid();
        const identifier = (result.data && result.data.user && result.data.user.id) || uid;
        wechatAuth.markProvider('wechat');
        this.pendingIdentifier = String(identifier || uid);
        await this.finishBind(ticket.data.subjectId, ticket.data.id, this.pendingIdentifier);
    },

    /**
     * 把新 uid 并入原主体并登记凭据。
     * 两种中断都会保留票据，页面给「重试绑定」：
     *   1) 并主体失败（网络 / 票据过期）
     *   2) 该标识原本就属于另一个主体 —— 归属冲突，必须由用户显式确认才合并
     */
    async finishBind(subjectId, ticketId, identifier) {
        const uid = await identity.currentUid();
        if (!uid) {
            this.setData({ submitting: false, tip: '', error: '会话已失效，请重新登录' });
            return;
        }

        if (uid !== this.oldUid) {
            // 这个登录标识原本属于哪个主体？空串 = 从没登录过的新身份
            const previous = await identity.subjectOf(uid);
            if (previous && previous !== subjectId) {
                // 归属冲突：不自动合并，把选择权交回用户
                this.setData({
                    submitting: false,
                    tip: '',
                    pending: true,
                    conflict: true,
                    error: '这个' + identity.providerLabel(this.data.provider) +
                        '已经属于另一个账号。合并后两个账号的数据会放在一起，请确认是否要合并。',
                });
                return;
            }
            const joined = await this.joinWithRetry(subjectId, ticketId);
            if (!joined) {
                this.setData({
                    submitting: false,
                    tip: '',
                    pending: true,
                    conflict: false,
                    error: '已用该方式登录，但并入原账号未成功。原账号数据未变动，可直接重试。',
                });
                return;
            }
        }

        await identity.syncCredentialSubject(uid, subjectId);
        const registered = await identity.registerCredential(
            this.data.provider,
            identifier,
            { uid: uid, subjectId: subjectId }
        );
        if (registered.error) {
            this.setData({
                submitting: false,
                tip: '',
                pending: true,
                conflict: false,
                error: registered.error.message || '凭据登记失败，请重试',
            });
            return;
        }

        await identity.consumeTicket(ticketId);
        if (this.data.provider !== identity.PROVIDER_WECHAT) {
            wechatAuth.markProvider('password');
        }

        if (this.alive === false) return;
        this.pendingTicket = null;
        this.pendingIdentifier = '';
        getApp().resetSession();
        this.setData({
            submitting: false,
            tip: '',
            pending: false,
            conflict: false,
            bound: true,
            boundText: maskAccount(identifier) || identifier,
        });
        wx.showToast({ title: '绑定成功', icon: 'success' });
        setTimeout(function () {
            wx.navigateBack({ fail: function () { wx.redirectTo({ url: '/pages/account/account' }); } });
        }, 600);
    },

    /** 归属冲突时用户确认合并：跳过冲突拦截，直接并主体 */
    async onForceMerge() {
        if (this.data.submitting) return;
        const ticket = this.pendingTicket;
        if (!ticket) {
            this.setData({ pending: false, conflict: false, error: '绑定凭证已失效，请退回上一页重新发起绑定' });
            return;
        }
        this.setData({ submitting: true, error: '', tip: '正在合并…' });
        const identifier = this.pendingIdentifier || (this.challenge ? this.challenge.identifier : (this.data.identifier || ''));
        const joined = await this.joinWithRetry(ticket.subjectId, ticket.id);
        if (!joined) {
            this.setData({
                submitting: false,
                tip: '',
                pending: true,
                conflict: true,
                error: '合并未成功，原账号数据未变动。可再试一次，或稍后处理。',
            });
            return;
        }
        await this.finishBind(ticket.subjectId, ticket.id, identifier);
    },

    async joinWithRetry(subjectId, ticketId) {
        for (let i = 0; i < JOIN_RETRY; i += 1) {
            const joined = await identity.joinSubject(subjectId, ticketId, this.data.provider);
            if (!joined.error) return true;
            if (i < JOIN_RETRY - 1) await delay(300 * (i + 1));
        }
        return false;
    },

    /** 会话已切到新 uid、但并主体失败时，用同一张票重试（票 10 分钟内有效） */
    async onRetryBind() {
        if (this.data.submitting) return;
        const ticket = this.pendingTicket;
        if (!ticket) {
            this.setData({ pending: false, error: '绑定凭证已失效，请退回上一页重新发起绑定' });
            return;
        }
        this.setData({ submitting: true, error: '', tip: '正在重试…' });
        const identifier = this.pendingIdentifier || (this.challenge ? this.challenge.identifier : (this.data.identifier || ''));
        await this.finishBind(ticket.subjectId, ticket.id, identifier);
    },

    onBack() {
        wx.navigateBack({ fail: function () { wx.redirectTo({ url: '/pages/account/account' }); } });
    },

    startCountdown() {
        this.stopCountdown();
        this.countdownTimer = setInterval(() => {
            const next = this.data.countdown - 1;
            if (next <= 0) {
                this.stopCountdown();
                this.setData({ countdown: 0 });
                return;
            }
            this.setData({ countdown: next });
        }, 1000);
    },

    stopCountdown() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
    },
});
