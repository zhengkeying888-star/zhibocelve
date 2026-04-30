-- ============================================================
-- Supabase Schema: 直播排期策略看板
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ============================================================

-- 1. 创建排期状态表（单表存储全部应用状态 JSON）
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- 2. 开启 Row Level Security（默认安全）
alter table schedules enable row level security;

-- 3. 创建公开访问策略（任何人可读写，适合内部工具）
-- 如需限制访问，可改为基于用户邮箱的策略
create policy "Allow public access" on schedules
  for all
  using (true)
  with check (true);

-- 4. 开启实时同步（Real-time）
alter publication supabase_realtime add table schedules;

-- 5. 插入初始空记录
insert into schedules (state) values ('{}')
on conflict do nothing;
