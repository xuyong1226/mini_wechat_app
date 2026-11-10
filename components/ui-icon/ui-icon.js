// ui-icon：图标字体封装。name -> 字形，颜色由 color 控制（默认跟随父级文字色）。
// 字形来自 styles/fonts/iconfont（Feather Icons 子集，离线编译），codepoint 与映射一致。
const CODE = {
    'alert-circle': 0xEA01,
    'bar-chart-2': 0xEA02,
    'bell': 0xEA03,
    'check-circle': 0xEA04,
    'check-square': 0xEA05,
    'list': 0xEA06,
    'search': 0xEA07,
    'settings': 0xEA08,
    'shield': 0xEA09,
    'trash-2': 0xEA0A,
    'user': 0xEA0B
};

Component({
    properties: {
        name: {
            type: String,
            observer() { this.apply(); },
        },
        // 字号：数字按 rpx 处理，也可直接传带单位的字符串（如 "32rpx"）
        size: {
            type: String,
            value: '',
            observer() { this.apply(); },
        },
        // 颜色：CSS 颜色值；省略则跟随父级文字色
        color: {
            type: String,
            value: '',
            observer() { this.apply(); },
        },
    },

    data: {
        glyph: '',
        styleStr: '',
    },

    lifetimes: {
        attached() { this.apply(); },
    },

    methods: {
        apply() {
            const name = this.data.name;
            const size = this.data.size;
            const color = this.data.color;
            let style = '';
            if (size) {
                style += 'font-size:' + (/rpx|px|em|rem|%$/.test(size) ? size : size + 'rpx') + ';';
            }
            if (color) style += 'color:' + color + ';';
            this.setData({
                glyph: CODE[name] ? String.fromCharCode(CODE[name]) : '',
                styleStr: style,
            });
        },
    },
});
