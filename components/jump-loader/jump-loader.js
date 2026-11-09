Component({
    properties: {
        // 沿用各页原有加载文案，不改动触发时机与交互语义
        text: {
            type: String,
            value: '正在加载…',
        },
        // 变体：jump=加载跳动（默认）；sad=异常沮丧（低头垂肩、慢节奏小跳）
        mood: {
            type: String,
            value: 'jump',
        },
    },
});
