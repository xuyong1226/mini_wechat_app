/**
 * 资料层：user_profile 表的读写封装。
 * 归属由服务端 owner_id + RLS 决定，前端不发送 owner_id。
 * 昵称与头像是应用层展示资料（云端账号的 name/avatarUrl 只读、不可写），
 * 绑定邮箱/手机为应用层联系信息记录。
 */

const { cloud } = require('./cloud');
const { createTableAccess } = require('./workbuddy-data-access');
const { DEFAULT_AVATAR_ID, randomNickname } = require('./avatars');

const PROFILE_COLUMNS = [
    'id', 'nickname', 'avatar_id', 'contact_email', 'contact_phone',
    'created_at', 'updated_at',
];

function toMs(value) {
    if (!value) return Date.now();
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : Date.now();
}

function fromProfileRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        nickname: row.nickname || '',
        avatarId: row.avatar_id || DEFAULT_AVATAR_ID,
        contactEmail: row.contact_email || '',
        contactPhone: row.contact_phone || '',
        createdAt: toMs(row.created_at),
        updatedAt: toMs(row.updated_at),
    };
}

function toProfileRow(payload) {
    const row = {};
    if (payload.nickname !== undefined) row.nickname = payload.nickname;
    if (payload.avatarId !== undefined) row.avatar_id = payload.avatarId;
    if (payload.contactEmail !== undefined) row.contact_email = payload.contactEmail;
    if (payload.contactPhone !== undefined) row.contact_phone = payload.contactPhone;
    if (payload.updatedAt !== undefined) row.updated_at = new Date(payload.updatedAt).toISOString();
    return row;
}

const profiles = createTableAccess(cloud, {
    table: 'user_profile',
    columns: PROFILE_COLUMNS,
    fromRow: fromProfileRow,
    toRow: toProfileRow,
    orderBy: { column: 'created_at', ascending: false },
});

/**
 * 读取当前用户的资料；不存在时用随机昵称创建一条。
 * 注册后首次进入时调用，之后一直复用同一条。
 * 用共享 promise 兜住并发：同一时刻多次调用只会创建一条记录。
 */
let pending = null;

async function ensureProfile() {
    if (pending) return pending;
    pending = (async function () {
        const listed = await profiles.list();
        if (!listed.error && listed.data && listed.data.length) {
            return listed.data[0];
        }
        const created = await profiles.create({
            nickname: randomNickname(),
            avatarId: DEFAULT_AVATAR_ID,
        });
        if (created.error) {
            // 并发下可能撞 UNIQUE(owner_id)：重新读取已存在的那一行，不报错也不重复建号
            const retry = await profiles.list();
            if (!retry.error && retry.data && retry.data.length) return retry.data[0];
            return null;
        }
        return created.data;
    })();
    try {
        return await pending;
    } finally {
        pending = null;
    }
}

module.exports = {
    profiles: profiles,
    ensureProfile: ensureProfile,
    fromProfileRow: fromProfileRow,
    toProfileRow: toProfileRow,
};
