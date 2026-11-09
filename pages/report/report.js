const store = require('../../utils/store');
const aiService = require('../../utils/ai-service');
const guard = require('../../utils/auth-guard');

const RANGES = [
    { key: 7, label: '近 7 天' },
    { key: 30, label: '近 30 天' },
    { key: 90, label: '近 90 天' },
];

const CATEGORY_NAMES = {
    client: '客户商务',
    logistics: '物流调度',
    finance: '财务结算',
    task: '行动待办',
    material: '资料参考',
    study: '学习成长',
    idea: '想法灵感',
    life: '生活健康',
    general: '综合',
};

const HEAD_DATE = (function () {
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return (d.getMonth() + 1) + '.' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '　周' + week;
})();

Page({
    data: {
        headDate: HEAD_DATE,
        authState: 'checking',
        viewState: 'loading',
        errorMessage: '',
        ranges: RANGES,
        days: 7,
        generating: false,
        summary: '',
        actions: [],
        stats: null,
        categories: [],
        keywords: [],
        engine: '',
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
            this.getTabBar().setData({ selected: 3 });
        }
        if (guard.consumeSucceeded()) {
            getApp().resetSession();
            this.restore();
        }
        // 已生成过总结时回到本页刷新；用 viewState 判断，避免塞一个 WXML 用不到的 report 对象
        if (this.data.authState === 'signed-in' && this.data.viewState === 'ready') {
            this.loadReport();
        }
    },

    async restore() {
        this.setData({ viewState: 'loading' });
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out', viewState: 'ready' });
            guard.goLogin();
            return;
        }
        this.setData({ authState: 'signed-in' });
        await this.loadReport();
    },

    async loadReport() {
        this.setData({ generating: true, viewState: 'loading', errorMessage: '' });
        const listResult = await store.entries.list();
        if (listResult.error) {
            this.setData({
                viewState: 'error',
                errorMessage: listResult.error.message || '读取失败',
                generating: false,
            });
            return;
        }
        const entries = listResult.data || [];

        try {
            const report = await aiService.buildStageReport(entries, this.data.days);
            const categories = report.categories.map(function (c) {
                return {
                    key: c.key,
                    name: CATEGORY_NAMES[c.key] || c.key,
                    count: c.count,
                };
            });
            const maxCount = categories.length ? categories[0].count : 1;
            for (let i = 0; i < categories.length; i += 1) {
                categories[i].percent = Math.round(categories[i].count / maxCount * 100);
            }

            this.setData({
                viewState: 'ready',
                generating: false,
                summary: report.summary,
                actions: report.actions,
                stats: report.stats,
                categories: categories,
                keywords: report.keywords,
                engine: report.engine,
            });
        } catch (error) {
            this.setData({
                viewState: 'error',
                generating: false,
                errorMessage: '生成总结失败，请重试',
            });
        }
    },

    onRangeTap(event) {
        const days = event.currentTarget.dataset.days;
        this.setData({ days: days });
        this.loadReport();
    },

    onRegenerate() {
        this.loadReport();
    },

    onRetry() {
        this.restore();
    },

    onGoLogin() {
        guard.goLogin();
    },
});
