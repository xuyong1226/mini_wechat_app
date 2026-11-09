/**
 * 文本处理工具：分词、句子切分、关键词提取。
 * 纯函数，无 wx 依赖，可在本地校验脚本中直接跑。
 */

// 停用词（中文 + 英文常见）
const STOPWORDS = [
    '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个', '上', '也',
    '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '他',
    '她', '它', '们', '与', '及', '或', '但', '而', '并', '因为', '所以', '如果', '可以', '这个',
    '那个', '什么', '怎么', '为了', '还有', '一下', '一些', '以及', '之后', '时候', '现在', '已经',
    'the', 'and', 'for', 'you', 'are', 'not', 'with', 'this', 'that', 'from', 'have', 'has',
];

const STOPWORD_SET = new Set(STOPWORDS);

// 业务词典：用于最大正向匹配，保证长词不被切碎
const DICT = [
    // 物流 / 供应链
    '运单', '短驳', '整车', '零担', '专线', '承运商', '发运', '提货', '送货', '到货', '签收', '回单',
    '在途', '库存', '调度', '发车', '到货时效', '时效', '运费', '单价', '重量', '体积', '方数',
    '装载率', '装载', '整车比价', '比价', '分单', '干线', '提货工厂', '网点', '订单', '客户', '货主',
    '物流', '仓储', '配送', '运输', '配送费', '回单管理', '库存管理', '运价', '计费重量', '抛重',
    // 商务 / 财务
    '报价', '合同', '结算', '对账', '账单', '发票', '付款', '回款', '成本', '利润', '毛利', '预算',
    '收入', '支出', '费用', '金额', '税率', '发票税率', '账期', '首付', '尾款', '保证金', '押金',
    '采购', '招标', '比价单', '过磅', '付款条件', '结算周期',
    // 工作流程
    '会议', '纪要', '沟通', '确认', '跟进', '反馈', '汇报', '方案', '需求', '排期', '计划', '复盘',
    '评审', '上线', '交付', '验收', '排查', '处理', '审批', '签字', '盖章', '存档', '归档',
    // 通用工作
    '客户需求', '重点客户', '新客户', '项目', '任务', '计划', '目标', '风险', '问题', '问题单',
    '时间', '日期', '截止', '截止日期', '优先级', '紧急', '重要', '负责人', '责任人', '进度', '状态',
    // 学习 / 个人
    '学习', '笔记', '总结', '复盘笔记', '读书', '课程', '知识点', '心得', '想法', '灵感', '创意',
    '待办', '提醒', '备忘', '清单', '习惯', '打卡', '目标管理', '个人', '生活', '家庭', '健康',
    // 系统 / 技术
    '系统', '接口', '对接', '数据', '报表', '看板', '工单', '审批流', '权限', '账号', '密码', '登录',
    '开发', '上线版本', '版本', '需求文档', '小程序', '后台', '导入', '导出', '字段',
    // 常见时间与量词（抑制二元组噪声）
    '今天', '明天', '后天', '昨天', '前天', '上午', '下午', '晚上', '早上', '中午', '今晚',
    '本周', '下周', '上周', '本月', '下月', '上月', '季度', '月初', '月底', '周末', '工作日',
    '截止', '金额', '账单', '发票', '对账', '回单', '运价', '报价单', '时效', '口径',
    // 常用名词
    '自动', '工具', '比较', '自动比价', '目的地', '报价比较', '方式', '方法', '办法',
    '支持', '每方', '每公斤', '体积重', '计费', '计费方式', '公斤', '里程', '件数', '件数方式',
    '小工具', '开发', '需求', '痛点', '效率', '时间成本', '手工', '人工',
    '核对', '记得', '提前', '财务', '四种', '广州', '长沙', '需要', '超过', '时限', '标记',
    '工作日', '上传', '归档', '扫描', '系统', '零担', '整车', '专线', '承运商', '报价', '比价',
];

// 二元组首尾字黑名单：这些字构成的组合多为切分碎片
const FRAGMENT_CHARS = new Set([
    '能', '可', '以', '要', '会', '想', '做', '让', '把', '被', '给', '跟', '从', '向', '到', '于',
    '对', '为', '而', '但', '却', '就', '也', '都', '还', '再', '又', '更', '最', '很', '太', '挺',
    '个', '些', '点', '们', '之', '其', '此', '该', '等', '中', '上', '下', '前', '后', '里', '外',
    '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '不', '没', '无', '非', '很', '挺',
    '吗', '呢', '吧', '啊', '呀', '哦', '嘛', '么', '之', '乎', '者', '所', '使', '令', '即',
]);

const DICT_SET = new Set(DICT);

// 分类词典：key -> { name, keywords }
const CATEGORY_RULES = [
    {
        key: 'client',
        name: '客户商务',
        keywords: ['客户', '报价', '合同', '回款', '账期', '付款', '招标', '商务', '续约', '对接人', '甲方'],
    },
    {
        key: 'logistics',
        name: '物流调度',
        keywords: ['运单', '短驳', '整车', '零担', '专线', '承运商', '发运', '提货', '到货', '签收',
            '回单', '在途', '调度', '发车', '时效', '运费', '装载', '分单', '干线', '网点', '运输'],
    },
    {
        key: 'finance',
        name: '财务结算',
        keywords: ['结算', '对账', '账单', '发票', '付款', '回款', '成本', '利润', '毛利', '预算', '金额', '费率'],
    },
    {
        key: 'task',
        name: '行动待办',
        keywords: ['待办', '要做', '记得', '别忘', '需要', '截止', '安排', '跟进', '处理', '提交', '确认',
            '完成', '准备', '催', '提醒', '明天', '后天', '本周', '下周', '尽快'],
    },
    {
        key: 'material',
        name: '资料参考',
        keywords: ['资料', '文档', '方案', '需求', '报告', '标准', '规范', '流程', '制度', '说明', '手册',
            '纪要', '笔记', '参考', '摘录', '教程'],
    },
    {
        key: 'study',
        name: '学习成长',
        keywords: ['学习', '读书', '课程', '知识点', '心得', '方法论', '模型', '框架', '复盘', '认知', '工具'],
    },
    {
        key: 'idea',
        name: '想法灵感',
        keywords: ['想法', '灵感', '创意', '点子', '设想', '如果', '或许', '能不能', '是否', '设想成', '构想'],
    },
    {
        key: 'life',
        name: '生活健康',
        keywords: ['家里', '家人', '孩子', '运动', '健身', '体检', '医院', '旅行', '买', '吃饭', '休息', '睡眠'],
    },
];

const CATEGORY_LIST = CATEGORY_RULES.map(function (item) { return item.key; });

function toHalfWidth(str) {
    return String(str).replace(/[\uff01-\uff5e]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    }).replace(/\u3000/g, ' ');
}

/** 归一化：全角转半角、去标点、压缩空白 */
function normalize(str) {
    const half = toHalfWidth(String(str || ''));
    const cleaned = half.replace(/[，。；：！？、（）【】《》“”‘’~@#￥%……&*—\-_+=|\\/\[\]{}<>"'`]/g, ' ');
    return cleaned.replace(/\s+/g, ' ').trim();
}

/** 句子切分 */
function splitSentences(text) {
    const raw = String(text || '').replace(/\r/g, '');
    const parts = raw.split(/(?<=[。！？!?；;\n])/);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
        const s = parts[i].trim();
        if (s) out.push(s);
    }
    return out;
}

function isStop(word) {
    if (!word) return true;
    if (STOPWORD_SET.has(word)) return true;
    // 纯数字（含金额）不作关键词
    if (/^[0-9]+(\.[0-9]+)?$/.test(word)) return true;
    if (word.length === 1 && /[a-zA-Z]/.test(word)) return true;
    return false;
}

/**
 * 分词：词典最大正向匹配 + 未命中片段的二元组兜底。
 * 返回 { tokens, counts }
 */
function tokenize(text) {
    const norm = normalize(text);
    const tokens = [];
    const hanRuns = [];
    let buffer = '';

    function flushLatin() {
        if (buffer) {
            const low = buffer.toLowerCase();
            if (low.length > 1) tokens.push(low);
            buffer = '';
        }
    }

    for (let i = 0; i < norm.length; i += 1) {
        const ch = norm.charAt(i);
        if (/[a-zA-Z0-9]/.test(ch)) {
            buffer += ch;
            continue;
        }
        flushLatin();
        if (/[\u4e00-\u9fa5]/.test(ch)) {
            // 汉字按连续串收集
            let j = i;
            let run = '';
            while (j < norm.length && /[\u4e00-\u9fa5]/.test(norm.charAt(j))) {
                run += norm.charAt(j);
                j += 1;
            }
            hanRuns.push(run);
            i = j - 1;
        }
    }
    flushLatin();

    for (let k = 0; k < hanRuns.length; k += 1) {
        const run = hanRuns[k];
        let pos = 0;
        // 未命中词典的片段
        let gap = '';

        function flushGap() {
            if (!gap) return;
            const seg = gap;
            gap = '';
            if (seg.length === 1) {
                if (!isStop(seg)) tokens.push(seg);
                return;
            }
            // 片段内二元组：只保留在整段中出现 >=2 次的组合（重复出现更像真实词）
            const counts = {};
            for (let p = 0; p + 1 < seg.length; p += 1) {
                const pair = seg.substr(p, 2);
                counts[pair] = (counts[pair] || 0) + 1;
            }
            for (let p = 0; p + 1 < seg.length; p += 1) {
                const pair = seg.substr(p, 2);
                if (DICT_SET.has(pair)) continue;
                if (FRAGMENT_CHARS.has(pair.charAt(0)) || FRAGMENT_CHARS.has(pair.charAt(1))) continue;
                if (counts[pair] < 2) continue;
                tokens.push(pair);
            }
        }

        while (pos < run.length) {
            let matched = '';
            for (let len = Math.min(8, run.length - pos); len >= 2; len -= 1) {
                const piece = run.substr(pos, len);
                if (DICT_SET.has(piece)) { matched = piece; break; }
            }
            if (matched) {
                flushGap();
                tokens.push(matched);
                pos += matched.length;
            } else {
                gap += run.charAt(pos);
                pos += 1;
            }
        }
        flushGap();
    }

    const filtered = [];
    for (let i = 0; i < tokens.length; i += 1) {
        if (!isStop(tokens[i])) filtered.push(tokens[i]);
    }

    const counts = {};
    for (let i = 0; i < filtered.length; i += 1) {
        counts[filtered[i]] = (counts[filtered[i]] || 0) + 1;
    }
    return { tokens: filtered, counts: counts };
}

/** 关键词提取：按出现次数排序，词典词优先 */
function topKeywords(text, limit) {
    const max = limit || 8;
    const counts = tokenize(text).counts;
    const list = [];
    for (const word in counts) {
        if (!Object.prototype.hasOwnProperty.call(counts, word)) continue;
        const weight = counts[word] * (DICT_SET.has(word) ? 2.2 : 1);
        list.push({ word: word, count: counts[word], weight: Math.round(weight * 100) / 100 });
    }
    list.sort(function (a, b) {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return b.word.length - a.word.length;
    });
    return list.slice(0, max);
}

/** 关键词集合（去重、去停用） */
function keywordSet(text, limit) {
    const list = topKeywords(text, limit || 12);
    const set = {};
    for (let i = 0; i < list.length; i += 1) set[list[i].word] = true;
    return set;
}

/** Jaccard 相似度 */
function jaccard(setA, setB) {
    let inter = 0;
    let union = 0;
    for (const key in setA) {
        if (!Object.prototype.hasOwnProperty.call(setA, key)) continue;
        union += 1;
        if (setB[key]) inter += 1;
    }
    for (const key in setB) {
        if (!Object.prototype.hasOwnProperty.call(setB, key)) continue;
        if (!setA[key]) union += 1;
    }
    if (!union) return 0;
    return inter / union;
}

/** 统计一段文本中的中文数字/日期/金额线索 */
function extractSignals(text) {
    const src = String(text || '');
    const signals = { dates: [], amounts: [], percents: [], quantities: [] };
    const dateRe = /(\d{4}\s*[年\-\/.]\s*\d{1,2}\s*[月\-\/.]\s*\d{1,2}\s*日?|\d{1,2}\s*[月\-\/.]\s*\d{1,2}\s*日?|周[一二三四五六日天]|下?周[一二三四五六日天]|今[天晚]|明[天早]|后[天]|月底|月初|季度末)/g;
    const amountRe = /([0-9][0-9,，.]*\s*(?:元|块|万元|万|亿|人民币|美元|USD|RMB))/g;
    const percentRe = /([0-9]+(?:\.[0-9]+)?\s*%)/g;
    const quantityRe = /([0-9]+(?:\.[0-9]+)?\s*(?:个|件|票|托|方|公斤|kg|吨|件\/天|单|台|人|次|车))/g;

    let m = dateRe.exec(src);
    while (m) { signals.dates.push(m[0]); m = dateRe.exec(src); }
    m = amountRe.exec(src);
    while (m) { signals.amounts.push(m[0]); m = amountRe.exec(src); }
    m = percentRe.exec(src);
    while (m) { signals.percents.push(m[0]); m = percentRe.exec(src); }
    m = quantityRe.exec(src);
    while (m) { signals.quantities.push(m[0]); m = quantityRe.exec(src); }

    return signals;
}

module.exports = {
    STOPWORDS: STOPWORDS,
    DICT: DICT,
    CATEGORY_RULES: CATEGORY_RULES,
    CATEGORY_LIST: CATEGORY_LIST,
    normalize: normalize,
    splitSentences: splitSentences,
    tokenize: tokenize,
    topKeywords: topKeywords,
    keywordSet: keywordSet,
    jaccard: jaccard,
    extractSignals: extractSignals,
};
