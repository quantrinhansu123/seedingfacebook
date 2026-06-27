-- Workflow kịch bản content: tách task và từng dòng/block nội dung.
-- Chạy trong Supabase SQL Editor của project đang dùng cho seeding-beta.

create table if not exists public.content_tasks (
    id                    text primary key,
    title                 text not null default '',
    assignee_id           text,
    assignee_name         text not null default '',
    assignee_username     text,
    status                text not null default 'todo',
    priority              text not null default 'medium',
    due_date              text,
    script_id             text unique,
    platform              text not null default 'TikTok',
    notes                 jsonb not null default '[]'::jsonb,
    timeline              jsonb not null default '[]'::jsonb,
    created_by_staff_id   text,
    created_by_staff_name text,
    approved_by_staff_id  text,
    approved_by_staff_name text,
    started_at            timestamptz,
    submitted_at          timestamptz,
    approved_at           timestamptz,
    completed_at          timestamptz,
    archived_at           timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create table if not exists public.content_script_blocks (
    id           text primary key,
    task_id      text not null references public.content_tasks(id) on delete cascade,
    script_id    text not null,
    block_order  integer not null default 0,
    content_type text not null default 'text',
    content      text not null default '',
    metadata     jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'content_tasks_status_check'
    ) then
        alter table public.content_tasks
            add constraint content_tasks_status_check
            check (status in ('todo', 'doing', 'pending', 'approved', 'archived'));
    end if;
end $$;

alter table public.content_tasks add column if not exists assignee_id text;
alter table public.content_tasks add column if not exists assignee_name text default '';
alter table public.content_tasks add column if not exists assignee_username text;
alter table public.content_tasks add column if not exists priority text default 'medium';
alter table public.content_tasks add column if not exists due_date text;
alter table public.content_tasks add column if not exists script_id text unique;
alter table public.content_tasks add column if not exists platform text default 'TikTok';
alter table public.content_tasks add column if not exists color text default '';
alter table public.content_tasks add column if not exists notes jsonb default '[]'::jsonb;
alter table public.content_tasks add column if not exists timeline jsonb default '[]'::jsonb;
alter table public.content_tasks add column if not exists approved_by_staff_id text;
alter table public.content_tasks add column if not exists approved_by_staff_name text;
alter table public.content_tasks add column if not exists started_at timestamptz;
alter table public.content_tasks add column if not exists submitted_at timestamptz;
alter table public.content_tasks add column if not exists approved_at timestamptz;
alter table public.content_tasks add column if not exists completed_at timestamptz;
alter table public.content_tasks add column if not exists archived_at timestamptz;

alter table public.content_script_blocks add column if not exists task_id text;
alter table public.content_script_blocks add column if not exists script_id text;
alter table public.content_script_blocks add column if not exists block_order integer default 0;
alter table public.content_script_blocks add column if not exists content_type text default 'text';
alter table public.content_script_blocks add column if not exists content text default '';
alter table public.content_script_blocks add column if not exists metadata jsonb default '{}'::jsonb;

create or replace function public.set_content_workflow_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_content_tasks_updated_at on public.content_tasks;
create trigger trg_content_tasks_updated_at
before update on public.content_tasks
for each row
execute function public.set_content_workflow_updated_at();

drop trigger if exists trg_content_script_blocks_updated_at on public.content_script_blocks;
create trigger trg_content_script_blocks_updated_at
before update on public.content_script_blocks
for each row
execute function public.set_content_workflow_updated_at();

create index if not exists idx_content_tasks_status on public.content_tasks(status);
create index if not exists idx_content_tasks_assignee on public.content_tasks(assignee_name);
create index if not exists idx_content_tasks_script_id on public.content_tasks(script_id);
create index if not exists idx_content_tasks_updated on public.content_tasks(updated_at desc);
create index if not exists idx_content_script_blocks_task_order on public.content_script_blocks(task_id, block_order);
create index if not exists idx_content_script_blocks_script_id on public.content_script_blocks(script_id);

alter table public.content_tasks enable row level security;
alter table public.content_script_blocks enable row level security;

drop policy if exists "content_tasks_anon_all" on public.content_tasks;
drop policy if exists "content_script_blocks_anon_all" on public.content_script_blocks;

create policy "content_tasks_anon_all"
on public.content_tasks
for all
to anon, authenticated
using (true)
with check (true);

create policy "content_script_blocks_anon_all"
on public.content_script_blocks
for all
to anon, authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.content_tasks to anon, authenticated, service_role;
grant select, insert, update, delete on public.content_script_blocks to anon, authenticated, service_role;

notify pgrst, 'reload schema';

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('content_tasks', 'content_script_blocks')
order by c.relname;
