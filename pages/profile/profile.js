// 「我的」页 · SCREEN 06：只保留身份行、主数字统计、4 格细统计、退出登录。
// 账号与安全 / 隐私协议 / 智能引擎三段已按设计稿移入「设置」页。

const store = require('../../utils/store');
const guard = require('../../utils/auth-guard');
const profileStore = require('../../utils/profile');
const notifications = require('../../utils/notifications');
const { findAvatar } = require('../../utils/avatars');

Page({
    data: {
        authState: 'checking',
        stats: null,
        nickname: '',
        avatar: { id: 'ink-1', bg: '#1A1A1A', fg: '#F7F5F0', glyph: '墨' },
        showAvatarPicker: false,
        unreadCount: 0,
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
            this.getTabBar().setData({ selected: 4 });
        }
        if (guard.consumeSucceeded()) {
            getApp().resetSession();
            this.restore();
            return;
        }
        // tab 页 onLoad 只执行一次，回到本页时刷新统计、资料与未读红点
        if (this.data.authState === 'signed-in') {
            this.loadStats();
            this.loadProfile();
        }
    },

    async restore() {
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out' });
            guard.goLogin();
            return;
        }
        this.setData({ authState: 'signed-in' });
        await this.loadStats();
        await this.loadProfile();
    },

    async loadStats() {
        const [entryResult, todoResult] = await Promise.all([
            store.entries.list(),
            store.todos.list(),
        ]);
        if (entryResult.error) return;
        const entries = entryResult.data || [];
        const todos = todoResult.error ? [] : (todoResult.data || []);
        let open = 0;
        for (let i = 0; i < todos.length; i += 1) {
            if (todos[i].status !== 'done') open += 1;
        }
        this.setData({
            // 复用本次已取到的 entries / todos，不额外发请求；通知开关关闭时不显示红点
            unreadCount: notifications.isEnabled()
                ? notifications.unreadCount(notifications.build(
                    { entries: entries, todos: todos }, notifications.readState()
                ))
                : 0,
            stats: {
                entries: entries.length,
                ideas: entries.filter(function (e) { return e.type === 'idea'; }).length,
                materials: entries.filter(function (e) { return e.type === 'material'; }).length,
                todos: todos.length,
                open: open,
            },
        });
    },

    /** 读取资料；首次进入时随机分配昵称 */
    async loadProfile() {
        const row = await profileStore.ensureProfile();
        if (!row) return;
        this.setData({
            nickname: row.nickname || '',
            avatar: findAvatar(row.avatarId),
        });
    },

    onOpenSettings() {
        wx.navigateTo({ url: '/pages/settings/settings' });
    },

    onOpenMessages() {
        wx.navigateTo({ url: '/pages/messages/messages' });
    },

    onAvatarTap() {
        this.setData({ showAvatarPicker: true });
    },

    onClosePicker() {
        this.setData({ showAvatarPicker: false });
    },

    async onAvatarSelect(event) {
        const id = event.detail.id;
        this.setData({ showAvatarPicker: false });
        const row = await this.saveProfile({ avatarId: id });
        if (row) {
            this.setData({ avatar: findAvatar(row.avatarId) });
            wx.showToast({ title: '头像已更新', icon: 'success' });
        }
    },

    onNicknameTap() {
        const self = this;
        wx.showModal({
            title: '编辑昵称',
            editable: true,
            placeholderText: '给自己起个名字',
            content: this.data.nickname || '',
            success: function (res) {
                if (!res.confirm) return;
                const name = (res.content || '').trim();
                if (!name) {
                    wx.showToast({ title: '昵称不能为空', icon: 'none' });
                    return;
                }
                if (name.length > 20) {
                    wx.showToast({ title: '昵称最多 20 个字', icon: 'none' });
                    return;
                }
                self.saveProfile({ nickname: name }).then(function (row) {
                    if (row) {
                        self.setData({ nickname: row.nickname });
                        wx.showToast({ title: '昵称已更新', icon: 'success' });
                    }
                });
            },
        });
    },

    async saveProfile(patch) {
        const payload = Object.assign({ updatedAt: Date.now() }, patch);
        const listed = await profileStore.profiles.list();
        if (listed.error || !listed.data || !listed.data.length) {
            wx.showToast({ title: '资料保存失败', icon: 'none' });
            return null;
        }
        const result = await profileStore.profiles.update(listed.data[0].id, payload);
        if (result.error) {
            wx.showToast({ title: result.error.message || '资料保存失败', icon: 'none' });
            return null;
        }
        return result.data;
    },

    async onSignOut() {
        const confirm = await new Promise(function (resolve) {
            wx.showModal({
                title: '退出登录',
                content: '退出后需要重新登录才能查看记录',
                success: function (res) { resolve(res.confirm); },
                fail: function () { resolve(false); },
            });
        });
        if (!confirm) return;

        try {
            await store.cloud.auth.signOut();
        } catch (error) {
            // 忽略退出异常，仍重置本地会话状态
        }
        getApp().resetSession();
        this.setData({ authState: 'signed-out', stats: null });
        wx.showToast({ title: '已退出', icon: 'success' });
        guard.goLogin();
    },

    onGoLogin() {
        guard.goLogin();
    },
});
