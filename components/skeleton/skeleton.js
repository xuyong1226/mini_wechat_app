// SCREEN 12 骨架屏：按记录流真实版面占位，不用通用转圈。
// 只负责列表区；刊头由页面保留。
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
    },

    data: {
        rowsArr: [0, 1, 2, 3],
    },
});
