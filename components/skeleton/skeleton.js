// SCREEN 12 骨架屏：按真实版面占位，不用通用转圈。
// variant:
//   'timeline'（默认）—— 记录流 / 待办 / 检索结果，圆点 + 正文行
//   'card'           —— 详情 / 总结，纸白卡片 + 标题条 + 正文行
// 只负责占位区；刊头由页面保留。
Component({
    properties: {
        rows: {
            type: Number,
            value: 4,
            observer: function (value) {
                const n = Math.max(1, Math.min(12, Number(value) || 4));
                const list = [];
                for (let i = 0; i < n; i += 1) list.push(i);
                this.setData({ rowsArr: list });
            },
        },
        variant: {
            type: String,
            value: 'timeline',
        },
    },

    data: {
        rowsArr: [0, 1, 2, 3],
    },
});
