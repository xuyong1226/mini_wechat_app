const guard = require('../../utils/auth-guard');
const wechatAuth = require('../../utils/wechat-auth');
const identity = require('../../utils/identity');

// 各来源页原先内嵌登录卡片的引导文案，拆分后集中到登录页按来源展示
const GUIDES = {
    'pages/index/index': '用账号密码登录，你的记录只存在自己的云端空间里。',
    'pages/search/search': '用账号密码登录后，你的记录才能被检索和提问。',
    'pages/todo/todo': '用账号密码登录后，这里会汇总你记录里抽取出来的待办事项。',
    'pages/report/report': '用账号密码登录，系统会基于你的全部记录生成阶段小结和行动建议。',
    'pages/profile/profile': '使用账号密码登录或注册。',
};

Page({
    data: {
        desc: GUIDES['pages/profile/profile'],
        viewState: 'checking',
        agreed: false,
    },

    onLoad(options) {
        // from 只用于登录后返回原页面，不进 data：WXML 未绑定的变量传进 setData 会被 IDE 警告
        this.from = guard.normalizeFrom(safeDecode(options.from));
        this.setData({ desc: GUIDES[this.from] || GUIDES['pages/profile/profile'] });
        this.checkSession();
    },

    /**
     * 首屏入口逻辑：已有会话直接进主应用，未登录才停留在登录界面。
     * 会话读取走 app.js 的缓存 promise，不额外发请求。
     */
    async checkSession() {
        const session = await getApp().ensureSession();
        if (!session) {
            this.setData({ viewState: 'ready' });
            return;
        }
        wx.switchTab({
            url: '/pages/index/index',
            fail: function () { wx.reLaunch({ url: '/pages/index/index' }); },
        });
    },

    /** 勾选/取消勾选用户协议与隐私政策 */
    onToggleAgree() {
        this.setData({ agreed: !this.data.agreed });
    },

    onOpenTerms() {
        wx.navigateTo({ url: '/pages/privacy/privacy?doc=terms' });
    },

    onOpenPrivacy() {
        wx.navigateTo({ url: '/pages/privacy/privacy?doc=privacy' });
    },

    /** 与原各页 onSignedIn 等价：重置会话缓存，由目标页重新 restore */
    onSignedIn(event) {
        getApp().resetSession();
        guard.markSucceeded();
        const detail = event && event.detail ? event.detail : {};
        const from = this.from || 'pages/index/index';

        // 已有账号通过验证码注册/登录时 SDK 不设密码，提示去设置密码
        if (detail.needPassword) {
            wx.showModal({
                title: '设置登录密码',
                content: '当前账号还没有登录密码。建议到「我的 → 账号与安全」用邮箱验证码设置密码，之后即可用账号密码登录。',
                showCancel: false,
                success: function () { guard.backToTarget('pages/index/index'); },
                fail: function () { guard.backToTarget('pages/index/index'); },
            });
            return;
        }

        // 首次微信登录：说明这是账号的一种登录方式，可后续绑定邮箱/手机号
        if (detail.provider === 'wechat' && wechatAuth.shouldShowWechatNotice()) {
            wechatAuth.markWechatNoticeShown();
            wx.showModal({
                title: '微信登录成功',
                content: '已用微信身份登录。到「我的 → 账号与安全」可绑定邮箱或手机号，绑定后两种方式进入同一份记录。',
                showCancel: false,
                confirmText: '我知道了',
                success: function () { guard.backToTarget(from); },
                fail: function () { guard.backToTarget(from); },
            });
            return;
        }

        // 该标识已被另一个账号占用：本次仍是独立账号，不自动合并，明确告知
        const claimed = detail.identity || null;
        if (claimed && claimed.status === 'conflict') {
            wx.showModal({
                title: '该登录方式已在其它账号下',
                content: '这个' + identity.providerLabel(claimed.provider) +
                    '已经绑定在另一个账号里，本次以独立账号登录，两边数据不会混在一起。' +
                    '如需合并，请到「我的 → 账号与安全」处理。',
                showCancel: false,
                confirmText: '我知道了',
                success: function () { guard.backToTarget(from); },
                fail: function () { guard.backToTarget(from); },
            });
            return;
        }

        guard.backToTarget(from);
    },
});

function safeDecode(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return '';
    }
}
