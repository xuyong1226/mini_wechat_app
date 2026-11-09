-- 01 统一用户主体：身份表
--
-- 模型：
--   auth 层的 uid（JWT sub）只是「一个登录凭据换来的会话身份」。
--   user_link      把多个 uid 归并到同一个 subject_id（用户主体）。
--   user_credential 记录 provider+identifier 属于哪个主体（同一标识只能属于一个主体）。
--   user_bind_ticket 绑定授权票据：证明「把某个 uid 并入某个主体」是主体本人授权的。
--
-- 全部列用 text：云端 auth.uid() 返回 text（不是 uuid），用 uuid 会在策略里报 42883。

-- 迁移期重建（生产已存在时不要重复执行 drop）
-- drop table if exists public.user_link;
-- drop table if exists public.user_credential;
-- drop table if exists public.user_bind_ticket;

create table if not exists public.user_link (
    uid         text primary key,
    subject_id  text not null,
    via         text not null default 'self',
    ticket_id   text,
    created_at  timestamptz not null default now()
);

create index if not exists user_link_subject_idx on public.user_link (subject_id);

create table if not exists public.user_credential (
    provider    text not null,   -- email | phone | wechat
    identifier  text not null,   -- 归一化后的邮箱/手机号/openid 或 uid
    subject_id  text not null,
    uid         text not null,
    created_at  timestamptz not null default now(),
    primary key (provider, identifier)   -- 同一登录标识只能归属于一个主体
);

create index if not exists user_credential_subject_idx on public.user_credential (subject_id);

create table if not exists public.user_bind_ticket (
    id          text primary key default gen_random_uuid()::text,
    subject_id  text not null,
    created_by  text not null,
    expires_at  timestamptz not null default now() + interval '10 minutes',
    used_at     timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists user_bind_ticket_subject_idx on public.user_bind_ticket (subject_id);
