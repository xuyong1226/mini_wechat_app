/**
 * 内置头像集与随机昵称生成。
 * 头像为纯样式渲染（色底 + 单字），不依赖外部图片、不需要用户授权，
 * 因此不引入 UserInfo 隐私项，也不会出现上传失败。
 * 昵称仅在首次进入时随机分配，之后用户可在「我的」里自行编辑。
 */

// id、底色、字色、单字；字色与底色保持明显明度差，保证识别度
const AVATARS = [
    { id: 'ink-1', bg: '#1A1A1A', fg: '#F7F5F0', glyph: '墨' },
    { id: 'ink-2', bg: '#D6452B', fg: '#FFFEFA', glyph: '朱' },
    { id: 'ink-3', bg: '#6B6862', fg: '#FFFEFA', glyph: '灰' },
    { id: 'ink-4', bg: '#E3DFD8', fg: '#1A1A1A', glyph: '白' },
    { id: 'ink-5', bg: '#2F3A3D', fg: '#E3DFD8', glyph: '青' },
    { id: 'ink-6', bg: '#3C4650', fg: '#EDF0F3', glyph: '黛' },
    { id: 'ink-7', bg: '#6B2F3A', fg: '#F3E6E8', glyph: '绛' },
    { id: 'ink-8', bg: '#3B4A2F', fg: '#EDF0E4', glyph: '苔' },
    { id: 'ink-9', bg: '#8A6A3B', fg: '#FFF6E6', glyph: '缃' },
    { id: 'ink-10', bg: '#2B3A55', fg: '#E2E8F2', glyph: '靛' },
    { id: 'ink-11', bg: '#46586B', fg: '#EEF2F5', glyph: '澜' },
    { id: 'ink-12', bg: '#C9C0B0', fg: '#1A1A1A', glyph: '砂' },
];

const DEFAULT_AVATAR_ID = 'ink-1';

const NAME_HEADS = [
    '沉静', '清晨', '晚风', '纸白', '细雨', '远山',
    '孤灯', '青石', '薄雾', '旧信', '长街', '半盏',
];

const NAME_TAILS = [
    '的旅人', '的记录者', '的守夜人', '的拾荒者', '的旁观者', '的整理者',
    '的行者', '的写字人', '的整理人', '的记事官', '的听众', '的脚印',
];

function findAvatar(id) {
    for (let i = 0; i < AVATARS.length; i += 1) {
        if (AVATARS[i].id === id) return AVATARS[i];
    }
    return AVATARS[0];
}

/** 随机昵称：两字词组 + 四位数字，注册后首次进入时使用 */
function randomNickname() {
    const head = NAME_HEADS[Math.floor(Math.random() * NAME_HEADS.length)];
    const tail = NAME_TAILS[Math.floor(Math.random() * NAME_TAILS.length)];
    const num = String(Math.floor(1000 + Math.random() * 9000));
    return head + tail + '_' + num;
}

/** 掩码显示账号标识，避免在界面上完整暴露 */
function maskAccount(value) {
    const text = (value || '').trim();
    if (!text) return '';
    if (text.indexOf('@') >= 0) {
        const at = text.indexOf('@');
        const head = text.slice(0, at);
        const tail = text.slice(at);
        if (head.length <= 2) return head[0] + '***' + tail;
        return head.slice(0, 2) + '***' + tail;
    }
    const digits = text.replace(/\s/g, '');
    if (digits.length <= 7) return digits.slice(0, 2) + '***' + digits.slice(-2);
    return digits.slice(0, 3) + '****' + digits.slice(-4);
}

module.exports = {
    AVATARS: AVATARS,
    DEFAULT_AVATAR_ID: DEFAULT_AVATAR_ID,
    findAvatar: findAvatar,
    randomNickname: randomNickname,
    maskAccount: maskAccount,
};
