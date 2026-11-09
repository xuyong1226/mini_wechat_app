// SCREEN 07 单一登录入口：账号 + 密码，提交时自动检测账号状态。
// - 已注册 → signInWithPassword 直接登录；
// - 未注册 → 页内展开「验证码 + 确认密码」，走 sendOtp + verifyOtp 建号并登录。
//   SDK 硬性要求先验码才允许 signUp 设密码，所以注册仍需要收码，没有独立注册页 / tab。
// - 忘记密码 → resetPasswordForEmail + updateUser（仅邮箱，手机号找回未开放）。
// 账号 = 邮箱或手机号（云端要求二者恰好其一）。

const { cloud } = require('../../utils/cloud');
const wechatAuth = require('../../utils/wechat-auth');
const identity = require('../../utils/identity');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9][0-9\s-]{5,19}$/;
const COUNTDOWN_SECONDS = 60;
const MIN_PASSWORD_LENGTH = 6;

function accountKind(value) {
    const text = (value || '').trim();
    if (!text) return '';
    if (EMAIL_RE.test(text)) return 'email';
    if (PHONE_RE.test(text)) return 'phone';
    return '';
}

function accountPayload(kind, value) {
    return kind === 'email' ? { email: value } : { phone: value };
}

function submitText(mode, signup) {
    if (mode === 'forgot') return '重置密码';
    if (signup) return '创建并登录';
    return '登录';
}

/**
 * 登录失败时是否「明确」是账号不存在。
 * 只有明确命中才自动发验证码展开注册；拿不准时不发码，只给手动入口，
 * 避免用户每次密码打错都白收一条验证码。
 */
function isLikelyNewAccount(error) {
    if (!error) return false;
    if (error.kind === 'not-found') return true;
    const parts = [
        error.message,
        error.code,
        error.cause && (error.cause.message || error.cause.code),
    ].filter(Boolean).join(' ');
    return /not\s*found|does\s*not\s*exist|no\s*user|user_not_found|not\s*registered|账号不存在|用户不存在|未注册/i.test(parts);
}

Component({
    properties: {
        // 家长页传入：是否已勾选同意用户协议与隐私政策，未勾选不允许提交
        agreed: { type: Boolean, value: false },
    },

    data: {
        mode: 'login',          // login | forgot
        signup: false,          // 是否展开注册区（自动检测或手动入口触发）
        account: '',
        password: '',
        confirmPassword: '',
        code: '',
        newPassword: '',
        sending: false,
        submitting: false,
        countdown: 0,
        tip: '',
        error: '',
        submitText: '登录',
        wechatLoggingIn: false,
    },

    lifetimes: {
        attached() {
            this.alive = true;
        },
        detached() {
            this.alive = false;
            this.stopCountdown();
        },
    },

    methods: {
        onAccountInput(event) {
            const next = event.detail.value;
            const patch = { account: next, error: '' };
            // 换了账号，之前发的验证码 / 重置句柄就作废，必须重新获取
            if ((this.challenge && this.challenge.value !== (next || '').trim()) || this.resetHandle) {
                this.challenge = null;
                this.resetHandle = null;
                patch.code = '';
            }
            this.setData(patch);
        },

        onPasswordInput(event) {
            this.setData({ password: event.detail.value, error: '' });
        },

        onConfirmInput(event) {
            this.setData({ confirmPassword: event.detail.value, error: '' });
        },

        onCodeInput(event) {
            this.setData({ code: event.detail.value, error: '' });
        },

        onNewPasswordInput(event) {
            this.setData({ newPassword: event.detail.value, error: '' });
        },

        /** 登录 / 忘记密码切换；注册区一律收起 */
        onSwitchMode(event) {
            const mode = event.currentTarget.dataset.mode;
            if (!mode || mode === this.data.mode) return;
            this.stopCountdown();
            this.challenge = null;
            this.resetHandle = null;
            this.setData({
                mode: mode,
                signup: false,
                submitText: submitText(mode, false),
                tip: '',
                error: '',
                countdown: 0,
                code: '',
            });
        },

        /** 手动「没有账号？注册」入口 */
        async onOpenSignup() {
            if (this.data.submitting || this.data.sending) return;
            await this.expandSignup();
        },

        /** 收起注册区，回到单一登录入口 */
        onCloseSignup() {
            this.stopCountdown();
            this.challenge = null;
            this.setData({
                signup: false,
                submitText: submitText(this.data.mode, false),
                tip: '',
                error: '',
                countdown: 0,
                code: '',
                confirmPassword: '',
            });
        },

        /**
         * 展开注册区并自动发验证码。
         * 由登录失败自动检测或手动入口触发，都会发一次验证码。
         */
        async expandSignup() {
            this.setData({
                signup: true,
                submitText: submitText('login', true),
                error: '',
                tip: '',
            });
            await this.sendCode();
        },

        /** 发送验证码：注册展开区走 sendOtp；忘记密码走 resetPasswordForEmail（它同时发码） */
        async sendCode() {
            if (this.data.sending || this.data.countdown > 0) return;
            const value = (this.data.account || '').trim();
            const kind = accountKind(value);
            if (!kind) {
                this.setData({ error: '请输入正确的邮箱或手机号' });
                return;
            }
            if (this.data.mode === 'forgot' && kind !== 'email') {
                this.setData({ error: '找回密码需使用注册时填写的邮箱' });
                return;
            }

            this.setData({ sending: true, error: '', tip: '' });
            let sent;
            try {
                if (this.data.mode === 'forgot') {
                    sent = await cloud.auth.resetPasswordForEmail(value);
                } else {
                    sent = await cloud.auth.sendOtp(accountPayload(kind, value));
                }
            } catch (error) {
                sent = { data: null, error: { message: '' } };
            }
            if (this.alive === false) return;
            this.setData({ sending: false });
            if (!sent || sent.error) {
                this.setData({ error: (sent && sent.error && sent.error.message) || '验证码发送失败，请重试' });
                return;
            }

            if (this.data.mode === 'forgot') {
                this.resetHandle = sent.data ? sent.data.updateUser : null;
                if (typeof this.resetHandle !== 'function') {
                    this.setData({ error: '验证码发送失败，请重试' });
                    return;
                }
            } else {
                const data = sent.data || {};
                // sendOtp 的 isExistingUser 是官方的账号状态检测：已存在就不能走注册
                if (this.data.signup && data.isExistingUser) {
                    this.onCloseSignup();
                    this.setData({ error: '该账号已注册，请检查密码后重试，或用「忘记密码」重设' });
                    return;
                }
                this.challenge = {
                    kind: kind,
                    value: value,
                    verificationId: data.verificationId,
                    isExistingUser: !!data.isExistingUser,
                };
            }
            this.setData({
                tip: this.data.signup
                    ? '该账号未注册，验证码已发送，填完即可创建并登录'
                    : '验证码已发送，请查收',
                countdown: COUNTDOWN_SECONDS,
            });
            this.startCountdown();
        },

        /** 提交：登录（含自动检测）/ 创建账号 / 重置密码三条路径 */
        async submit() {
            if (this.data.submitting) return;
            if (!this.properties.agreed) {
                this.setData({ error: '请先阅读并同意《用户协议》和《隐私政策》' });
                return;
            }

            const value = (this.data.account || '').trim();
            const kind = accountKind(value);
            if (!kind) {
                this.setData({ error: '请输入正确的邮箱或手机号' });
                return;
            }

            const inForgot = this.data.mode === 'forgot';
            const inSignup = this.data.signup;
            const password = inForgot ? this.data.newPassword : this.data.password;
            if (!password) {
                this.setData({ error: inForgot ? '请输入新密码' : '请输入密码' });
                return;
            }
            if (password.length < MIN_PASSWORD_LENGTH) {
                this.setData({ error: '密码至少 ' + MIN_PASSWORD_LENGTH + ' 位' });
                return;
            }
            if (inSignup) {
                if (password !== this.data.confirmPassword) {
                    this.setData({ error: '两次输入的密码不一致' });
                    return;
                }
                if (!this.challenge) {
                    this.setData({ error: '请先获取验证码' });
                    return;
                }
                if (!this.data.code) {
                    this.setData({ error: '请输入验证码' });
                    return;
                }
            }
            if (inForgot && (!this.resetHandle || !this.data.code)) {
                this.setData({ error: !this.data.code ? '请输入邮箱验证码' : '请先获取邮箱验证码' });
                return;
            }

            this.setData({ submitting: true, error: '', tip: '' });
            let result;
            let needPassword = false;
            try {
                if (inSignup) {
                    const c = this.challenge;
                    result = await cloud.auth.verifyOtp(Object.assign(accountPayload(c.kind, c.value), {
                        verificationId: c.verificationId,
                        isExistingUser: c.isExistingUser,
                        token: this.data.code,
                        password: c.isExistingUser ? undefined : password,
                    }));
                    needPassword = !!c.isExistingUser;
                } else if (inForgot) {
                    result = await this.resetHandle({ nonce: this.data.code, password: password });
                } else {
                    result = await cloud.auth.signInWithPassword(
                        Object.assign(accountPayload(kind, value), { password: password })
                    );
                }
            } catch (error) {
                result = { data: null, error: { message: '' } };
            }
            if (this.alive === false) return;
            this.setData({ submitting: false });

            if (result.error) {
                // 未展开注册、且明确是「账号不存在」→ 自动检测后展开注册区
                if (!inSignup && !inForgot && isLikelyNewAccount(result.error)) {
                    await this.expandSignup();
                    return;
                }
                const message = result.error.message || '';
                this.setData({
                    error: message || (inSignup ? '注册失败，请重试' : inForgot ? '重置失败，请重试' : '账号或密码不正确'),
                });
                return;
            }

            wechatAuth.markProvider('password');
            const claimed = await this.claimIdentity(kind, value);
            this.triggerEvent('signedin', {
                needPassword: needPassword,
                provider: 'password',
                identity: claimed,
            });
        },

        /**
         * 登录成功后把「本次登录用的标识」登记到当前用户主体。
         * 只是补账，失败不影响登录：拿不到结果就返回 null，页面按普通登录处理。
         */
        async claimIdentity(provider, identifier) {
            try {
                const app = typeof getApp === 'function' ? getApp() : null;
                // onLaunch 缓存的会话是登录前的，必须先失效再读
                if (app && typeof app.resetSession === 'function') app.resetSession();
                const claimed = await identity.claimAfterLogin(provider, identifier);
                return claimed && claimed.data ? claimed.data : null;
            } catch (error) {
                return null;
            }
        },

        /**
         * 微信登录：与账号密码登录并列，创建独立的微信身份账号。
         * 同样受协议勾选门禁约束；防重复点击；失败只给中性文案。
         */
        async onWechatLogin() {
            if (this.data.wechatLoggingIn || this.data.submitting) return;
            if (!this.properties.agreed) {
                this.setData({ error: '请先阅读并同意《用户协议》和《隐私政策》' });
                return;
            }
            this.setData({ wechatLoggingIn: true, error: '', tip: '' });
            const result = await wechatAuth.signIn();
            if (this.alive === false) return;
            this.setData({ wechatLoggingIn: false });
            if (result.error) {
                this.setData({
                    error: result.error.message || '微信登录失败，请重试',
                });
                return;
            }
            wechatAuth.markProvider('wechat');
            // 微信登录的「登录标识」就是本次换来的 uid：先让会话缓存失效再读
            const app = typeof getApp === 'function' ? getApp() : null;
            if (app && typeof app.resetSession === 'function') app.resetSession();
            const uid = await identity.currentUid();
            const claimed = uid ? await this.claimIdentity('wechat', uid) : null;
            this.triggerEvent('signedin', {
                needPassword: false,
                provider: 'wechat',
                identity: claimed,
            });
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
    },
});
