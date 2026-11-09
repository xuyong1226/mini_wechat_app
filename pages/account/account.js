const store = require('../../utils/store');
const guard = require('../../utils/auth-guard');
const profileStore = require('../../utils/profile');
const wechatAuth = require('../../utils/wechat-auth');
const identity = require('../../utils/identity');
const { maskAccount } = require('../../utils/avatars');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9][0-9\s-]{5,19}$/;
const MIN_PASSWORD_LENGTH = 6;

const PROVIDER_ROWS = [
    { provider: identity.PROVIDER_WECHAT, label: '微信' },
    { provider: identity.PROVIDER_EMAIL, label: '邮箱' },
    { provider: identity.PROVIDER_PHONE, label: '手机号' },
];

Page({
    data: {
        authState: 'checking',
        loginAccount: '',
        isWechat: false,
        accountLabel: '邮箱 / 手机号账号',
        providers: PROVIDER_ROWS,
        boundProviders: {},
        boundSummary: '',
        contactEmail: '',
        contactPhone: '',
        emailInput: '',
        phoneInput: '',
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
        resetEmail: '',
        resetCode: '',
        resetNewPassword: '',
        resetSending: false,
        resetSubmitting: false,
        savingEmail: false,
        savingPhone: false,
        changingPassword: false,
        pwdOpen: false,
        resetOpen: false,
        tip: '',
        error: '',
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        // 从绑定页返回时凭据列表可能已变，重新读一次
        if (this.data.authState === 'signed-in') this.loadCredentials();
    },

    async restore() {
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out' });
            guard.goLogin();
            return;
        }
        const user = session.user || {};
        const isWechat = wechatAuth.accountType(session) === 'wechat';
        this.setData({
            authState: 'signed-in',
            isWechat: isWechat,
            accountLabel: isWechat ? '微信账号' : '邮箱 / 手机号账号',
            loginAccount: isWechat ? '微信快捷登录' : (maskAccount(user.email || user.phone || '') || '未获取到'),
        });
        await Promise.all([this.loadProfile(), this.loadCredentials()]);
    },

    /**
     * 读出本主体下已绑定的登录凭据。
     * 主体层读失败只影响这张卡片，不影响账号页其它功能。
     */
    async loadCredentials() {
        const subject = await identity.ensureSubject();
        if (subject.error) return;
        const listed = await identity.listCredentials();
        const bound = {};
        (listed.data || []).forEach(function (row) {
            // 同一 provider 只展示第一条，作为「已绑定」的代表
            if (row.provider && !bound[row.provider]) {
                bound[row.provider] = maskAccount(row.identifier) || row.identifier;
            }
        });
        const names = Object.keys(bound).map(function (key) {
            if (key === identity.PROVIDER_WECHAT) return '微信';
            if (key === identity.PROVIDER_EMAIL) return '邮箱';
            if (key === identity.PROVIDER_PHONE) return '手机号';
            return '';
        }).filter(Boolean);
        // 渲染用行数据预先算好，WXML 里不做对象下标取值
        const rows = PROVIDER_ROWS.map(function (item) {
            return {
                provider: item.provider,
                label: item.label,
                bound: !!bound[item.provider],
                value: bound[item.provider] || '未绑定',
            };
        });
        this.setData({
            providers: rows,
            boundProviders: bound,
            boundSummary: names.length ? names.join(' / ') : '尚未绑定',
        });
    },

    /** 去绑定页：provider = wechat | email | phone */
    onBind(event) {
        const provider = event.currentTarget.dataset.provider;
        if (!provider) return;
        if (this.data.boundProviders[provider]) {
            wx.showToast({ title: '该方式已绑定', icon: 'none' });
            return;
        }
        wx.navigateTo({ url: '/pages/bind/bind?provider=' + provider });
    },

    async loadProfile() {
        const row = await profileStore.ensureProfile();
        if (!row) return;
        this.setData({
            contactEmail: row.contactEmail || '',
            contactPhone: row.contactPhone || '',
            emailInput: row.contactEmail || '',
            phoneInput: row.contactPhone || '',
        });
    },

    onEmailInput(event) {
        this.setData({ emailInput: event.detail.value, error: '' });
    },

    onPhoneInput(event) {
        this.setData({ phoneInput: event.detail.value, error: '' });
    },

    onOldPasswordInput(event) {
        this.setData({ oldPassword: event.detail.value, error: '' });
    },

    onNewPasswordInput(event) {
        this.setData({ newPassword: event.detail.value, error: '' });
    },

    onConfirmPasswordInput(event) {
        this.setData({ confirmPassword: event.detail.value, error: '' });
    },

    /** 保存备用邮箱（应用层联系信息） */
    async onSaveEmail() {
        const value = (this.data.emailInput || '').trim();
        if (!value) {
            this.setData({ error: '请输入邮箱地址' });
            return;
        }
        if (!EMAIL_RE.test(value)) {
            this.setData({ error: '邮箱格式不正确' });
            return;
        }
        const row = await this.saveProfile({ contactEmail: value });
        if (row) {
            this.setData({ contactEmail: row.contactEmail });
            wx.showToast({ title: '邮箱已保存', icon: 'success' });
        }
    },

    /** 保存备用手机（应用层联系信息） */
    async onSavePhone() {
        const value = (this.data.phoneInput || '').trim();
        if (!value) {
            this.setData({ error: '请输入手机号' });
            return;
        }
        if (!PHONE_RE.test(value)) {
            this.setData({ error: '手机号格式不正确' });
            return;
        }
        const row = await this.saveProfile({ contactPhone: value });
        if (row) {
            this.setData({ contactPhone: row.contactPhone });
            wx.showToast({ title: '手机号已保存', icon: 'success' });
        }
    },

    /** 修改密码：需原密码 */
    async onChangePassword() {
        if (this.data.changingPassword) return;
        const oldPassword = this.data.oldPassword || '';
        const newPassword = this.data.newPassword || '';
        if (!oldPassword) {
            this.setData({ error: '请输入原密码' });
            return;
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            this.setData({ error: '新密码至少 ' + MIN_PASSWORD_LENGTH + ' 位' });
            return;
        }
        if (newPassword !== this.data.confirmPassword) {
            this.setData({ error: '两次输入的新密码不一致' });
            return;
        }

        this.setData({ changingPassword: true, error: '', tip: '' });
        let result;
        try {
            result = await store.cloud.auth.resetPasswordForOld({
                oldPassword: oldPassword,
                newPassword: newPassword,
            });
        } catch (error) {
            result = { error: { message: '' } };
        }
        this.setData({ changingPassword: false });
        if (result.error) {
            this.setData({ error: result.error.message || '修改失败，请确认原密码是否正确' });
            return;
        }
        this.setData({ oldPassword: '', newPassword: '', confirmPassword: '', pwdOpen: false });
        wx.showToast({ title: '密码已修改', icon: 'success' });
    },

    /** 页内用邮箱验证码设置/重设密码，不跳转登录页，避免打断当前会话 */
    onResetEmailInput(event) {
        this.setData({ resetEmail: event.detail.value, error: '' });
    },

    onResetCodeInput(event) {
        this.setData({ resetCode: event.detail.value, error: '' });
    },

    onResetNewPasswordInput(event) {
        this.setData({ resetNewPassword: event.detail.value, error: '' });
    },

    async onSendResetCode() {
        if (this.data.resetSending) return;
        const email = (this.data.resetEmail || '').trim();
        if (!EMAIL_RE.test(email)) {
            this.setData({ error: '请输入注册时填写的邮箱' });
            return;
        }
        this.setData({ resetSending: true, error: '', tip: '' });
        let started;
        try {
            started = await store.cloud.auth.resetPasswordForEmail(email);
        } catch (error) {
            started = { error: { message: '' } };
        }
        this.setData({ resetSending: false });
        if (started.error) {
            this.setData({ error: started.error.message || '验证码发送失败，请重试' });
            return;
        }
        this.resetHandle = started.data ? started.data.updateUser : null;
        if (typeof this.resetHandle !== 'function') {
            this.setData({ error: '验证码发送失败，请重试' });
            return;
        }
        this.setData({ tip: '验证码已发送，请查收邮箱' });
    },

    async onConfirmReset() {
        if (this.data.resetSubmitting) return;
        if (typeof this.resetHandle !== 'function') {
            this.setData({ error: '请先获取邮箱验证码' });
            return;
        }
        const code = (this.data.resetCode || '').trim();
        const password = this.data.resetNewPassword || '';
        if (!code) {
            this.setData({ error: '请输入邮箱验证码' });
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            this.setData({ error: '新密码至少 ' + MIN_PASSWORD_LENGTH + ' 位' });
            return;
        }
        this.setData({ resetSubmitting: true, error: '', tip: '' });
        let result;
        try {
            result = await this.resetHandle({ nonce: code, password: password });
        } catch (error) {
            result = { error: { message: '' } };
        }
        this.setData({ resetSubmitting: false });
        if (result.error) {
            this.setData({ error: result.error.message || '设置失败，请重试' });
            return;
        }
        this.resetHandle = null;
        // SDK 在密码重置成功后会重新建立会话，清掉应用内会话缓存
        getApp().resetSession();
        this.setData({ resetCode: '', resetNewPassword: '', resetOpen: false, tip: '' });
        wx.showToast({ title: '密码已设置', icon: 'success' });
    },

    onGoLogin() {
        guard.goLogin();
    },

    /** 点按展开 / 收起「修改密码」页内表单（SCREEN 08） */
    onTogglePwdForm() {
        this.setData({ pwdOpen: !this.data.pwdOpen, error: '', tip: '' });
    },

    /** 点按展开 / 收起「忘记密码 / 首次设置密码」页内表单（SCREEN 08） */
    onToggleResetForm() {
        this.setData({ resetOpen: !this.data.resetOpen, error: '', tip: '' });
    },

    async saveProfile(patch) {
        const payload = Object.assign({ updatedAt: Date.now() }, patch);
        const listed = await profileStore.profiles.list();
        if (listed.error || !listed.data || !listed.data.length) {
            wx.showToast({ title: '保存失败', icon: 'none' });
            return null;
        }
        const result = await profileStore.profiles.update(listed.data[0].id, payload);
        if (result.error) {
            wx.showToast({ title: result.error.message || '保存失败', icon: 'none' });
            return null;
        }
        return result.data;
    },
});
