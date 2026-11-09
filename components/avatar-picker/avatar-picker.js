// 头像选择器：底部弹层，内置头像集（色底 + 单字），无需上传与授权。
const { AVATARS } = require('../../utils/avatars');

Component({
    properties: {
        visible: { type: Boolean, value: false },
        current: { type: String, value: '' },
    },

    data: {
        list: AVATARS,
    },

    methods: {
        onSelect(event) {
            const id = event.currentTarget.dataset.id;
            if (!id) return;
            this.triggerEvent('select', { id: id });
        },

        onClose() {
            this.triggerEvent('close');
        },
    },
});
