const llm = require('../../utils/llm');
const guard = require('../../utils/auth-guard');
const notifications = require('../../utils/notifications');

Page({
    data: {
        modelName: '',
        modelHint: '',
        noticeOn: true,
    },

    onLoad() {
        this.restore();
    },

    async restore() {
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            guard.goLogin();
            return;
        }
        this.setData({ noticeOn: notifications.isEnabled() });
        await this.loadModel();
    },

    /** 开关通知接收；状态存本地，关掉后「我的」页不再显示未读红点 */
    onToggleNotice() {
        const next = !this.data.noticeOn;
        notifications.setEnabled(next);
        this.setData({ noticeOn: next });
    },

    async loadModel() {
        try {
            const models = await llm.listModels();
            if (!models.length) {
                this.setData({ modelHint: '当前没有可用模型，智能整理将使用本地规则引擎' });
                return;
            }
            const model = await llm.resolveModel();
            this.setData({ modelName: model.name || model.id, modelHint: '' });
        } catch (error) {
            this.setData({ modelHint: '模型列表读取失败，智能整理将使用本地规则引擎' });
        }
    },

    onOpenAccount() {
        wx.navigateTo({ url: '/pages/account/account' });
    },

    onOpenTerms() {
        wx.navigateTo({ url: '/pages/privacy/privacy?doc=terms' });
    },
});
