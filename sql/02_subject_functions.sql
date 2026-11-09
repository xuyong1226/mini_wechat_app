-- 02 统一用户主体：解析函数
--
-- auth.uid() 在云端是 text；未登录时为 null。
-- 三个函数都是 SECURITY DEFINER + STABLE：
--   * DEFINER 让策略内部读 user_link 时绕过该表自身的 RLS，避免策略递归；
--   * STABLE 允许 Postgres 在同一条语句内缓存结果，避免逐行重算。

-- 当前会话 uid 所属的主体；没有绑定记录时，主体就是 uid 自己（向后兼容存量数据）
create or replace function public.current_subject_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select l.subject_id from public.user_link l where l.uid = auth.uid()),
        auth.uid()
    )
$$;

-- 当前主体下所有 uid 的集合。
-- 业务数据仍按 owner_id 存原始 uid，所以合并前创建的数据不会丢；
-- 判断归属时用「owner_id 落在本主体的任一 uid 上」。
create or replace function public.current_subject_scope()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with me as (
        select coalesce(
            (select l.subject_id from public.user_link l where l.uid = auth.uid()),
            auth.uid()
        ) as s
    )
    select case
        when (select s from me) is null then null
        else array(
            select x from (
                select (select s from me) as x
                union
                select l2.uid from public.user_link l2 where l2.subject_id = (select s from me)
            ) u
        )
    end
$$;

-- 绑定票据校验：必须是本主体的票、未过期、未使用
create or replace function public.verify_bind_ticket(p_ticket text, p_subject text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.user_bind_ticket t
        where t.id = p_ticket
          and t.subject_id = p_subject
          and t.expires_at > now()
          and t.used_at is null
    )
$$;
