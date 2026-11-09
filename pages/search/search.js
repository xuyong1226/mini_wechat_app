const store = require('../../utils/store');
const aiService = require('../../utils/ai-service');
const guard = require('../../utils/auth-guard');

const HEAD_DATE = (function () {
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return (d.getMonth() + 1) + '.' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '　周' + week;
})();

Page({
    data: {
        headDate: HEAD_DATE,
        authState: 'checking',
        viewState: 'ready',
        errorMessage: '',
        keyword: '',
        searching: false,
        results: [],
        searched: false,
        asking: false,
        question: '',
        answer: '',
        answerRefs: [],
        answerEmpty: false,
        answerSuggestions: [],
        engine: '',
    },

    onLoad() {
        this.restore();
    },

    onShow() {
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
            this.getTabBar().setData({ selected: 1 });
        }
        if (guard.consumeSucceeded()) {
            getApp().resetSession();
            this.restore();
        }
    },

    async restore() {
        this.setData({ viewState: 'loading' });
        const session = await getApp().ensureSession();
        if (!session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out' });
            guard.goLogin();
            return;
        }
        this.setData({ authState: 'signed-in' });
        await this.loadEntries();
    },

    async loadEntries() {
        this.setData({ viewState: 'loading', errorMessage: '' });
        const result = await store.entries.list();
        if (result.error) {
            this.setData({ viewState: 'error', errorMessage: result.error.message || '读取失败' });
            return;
        }
        this.allEntries = result.data || [];
        this.setData({ viewState: 'ready', errorMessage: '' });
    },

    onKeywordInput(event) {
        this.setData({ keyword: event.detail.value });
    },

    onQuestionInput(event) {
        this.setData({ question: event.detail.value });
    },

    async onSearch() {
        const keyword = (this.data.keyword || '').trim();
        if (!keyword) {
            wx.showToast({ title: '输入关键词', icon: 'none' });
            return;
        }
        if (this.data.searching) return;

        this.setData({ searching: true });
        const entries = this.allEntries || [];
        const hits = aiService.search(entries, keyword, 30);
        const results = hits.map(function (h) {
            const e = h.entry;
            return {
                id: e.id,
                title: e.title || aiService.summarize(e.content, 24),
                preview: (e.summary || e.content || '').substr(0, 80),
                type: e.type,
                tags: e.tags || [],
                hits: h.hits,
                score: h.score,
                timeText: formatTime(e.createdAt),
            };
        });
        this.setData({
            searching: false,
            results: results,
            searched: true,
        });
    },

    async onAsk() {
        const question = (this.data.question || '').trim();
        if (!question) {
            wx.showToast({ title: '输入你的问题', icon: 'none' });
            return;
        }
        if (this.data.asking) return;

        this.setData({ asking: true, answer: '', answerRefs: [], answerEmpty: false, answerSuggestions: [] });
        const entries = this.allEntries || [];

        try {
            const result = await aiService.askQuestion(entries, question);
            this.setData({
                asking: false,
                answer: result.answer,
                answerRefs: result.refs,
                answerEmpty: result.empty,
                answerSuggestions: result.suggestions || [],
                engine: result.engine,
            });
        } catch (error) {
            this.setData({
                asking: false,
                answer: '问答服务暂时不可用，请稍后再试。',
                answerEmpty: true,
            });
        }
    },

    onResultTap(event) {
        const id = event.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    },

    onRefTap(event) {
        const id = event.currentTarget.dataset.id;
        wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
    },

    onSuggestionTap(event) {
        const text = event.currentTarget.dataset.text;
        this.setData({ question: text });
    },

    onRetry() {
        this.restore();
    },

    onGoLogin() {
        guard.goLogin();
    },
});

function formatTime(ms) {
    const d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' '
        + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}
