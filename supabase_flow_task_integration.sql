-- Integrate seeding Supabase with F-Solution Flow and the task app.
-- Run this on the same Supabase project used by seedingfacebook.

create extension if not exists pgcrypto;

create table if not exists public.users (
    user_id     text primary key,
    full_name   text not null,
    username    text,
    email       text,
    phone       text,
    password    text,
    role        text not null default 'staff',
    avatar_url  text,
    enabled     boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

alter table public.users add column if not exists department text;
alter table public.users add column if not exists status text not null default 'active';
alter table public.users add column if not exists access_role text;
alter table public.users add column if not exists password text;

create table if not exists public.access_roles (
    role_key     text primary key,
    role_name    text not null,
    description  text,
    is_system    boolean not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists public.role_permissions (
    role_key    text not null references public.access_roles(role_key) on delete cascade,
    module_key  text not null,
    can_view    boolean not null default true,
    can_create  boolean not null default false,
    can_update  boolean not null default false,
    can_delete  boolean not null default false,
    can_manage  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    primary key (role_key, module_key)
);

insert into public.access_roles (role_key, role_name, description, is_system)
values
    ('admin', 'Admin', 'Toàn quyền quản trị hệ thống, tài khoản, phân quyền và mọi module.', true),
    ('worker', 'Nhân viên', 'Quyền vận hành cơ bản, không vào phần quản trị.', true)
on conflict (role_key) do update
set role_name = excluded.role_name,
    description = excluded.description,
    is_system = excluded.is_system,
    updated_at = now();

insert into public.role_permissions (role_key, module_key, can_view, can_create, can_update, can_delete, can_manage)
select 'admin', module_key, true, true, true, true, true
from (values
    ('dashboard'), ('customers'), ('marketing'), ('sale'), ('bao_gia'),
    ('task'), ('ba_sa'), ('dev'), ('cs'), ('settings'), ('accounts')
) as modules(module_key)
on conflict (role_key, module_key) do update
set can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_update = excluded.can_update,
    can_delete = excluded.can_delete,
    can_manage = excluded.can_manage,
    updated_at = now();

insert into public.role_permissions (role_key, module_key, can_view, can_create, can_update, can_delete, can_manage)
select 'worker', module_key, true, true, true, false, false
from (values
    ('dashboard'), ('customers'), ('marketing'), ('sale'), ('bao_gia'), ('task')
) as modules(module_key)
on conflict (role_key, module_key) do update
set can_view = excluded.can_view,
    can_create = excluded.can_create,
    can_update = excluded.can_update,
    can_delete = excluded.can_delete,
    can_manage = excluded.can_manage,
    updated_at = now();

create table if not exists public.customers (
    customer_id  uuid primary key default gen_random_uuid(),
    name         text not null,
    phone        text,
    email        text,
    department   text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists public.projects (
    project_id      uuid primary key default gen_random_uuid(),
    name            text not null,
    pricing         numeric not null default 0,
    status          text not null default 'active',
    owner_user_id   text references public.users(user_id) on delete set null,
    content_blocks  jsonb not null default '{}'::jsonb,
    documents       jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

alter table public.projects add column if not exists customer_id uuid references public.customers(customer_id) on delete set null;

create table if not exists public.features (
    feature_id      uuid primary key default gen_random_uuid(),
    project_id      uuid not null references public.projects(project_id) on delete cascade,
    name            text not null,
    status          text not null default 'pending',
    deadline        timestamptz,
    content_blocks  jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists public.tasks (
    task_id         uuid primary key default gen_random_uuid(),
    feature_id      uuid not null references public.features(feature_id) on delete cascade,
    parent_task_id  uuid references public.tasks(task_id) on delete cascade,
    name            text not null,
    assigned_to     text references public.users(user_id) on delete set null,
    description     text,
    image_url       text,
    content_blocks  jsonb not null default '{}'::jsonb,
    deadline        timestamptz,
    status          text not null default 'pending',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_features_project_id on public.features(project_id);
create index if not exists idx_tasks_feature_id on public.tasks(feature_id);
create index if not exists idx_tasks_parent_task_id on public.tasks(parent_task_id);
create index if not exists idx_tasks_assigned_to on public.tasks(assigned_to);
create index if not exists idx_tasks_feature_root on public.tasks(feature_id) where parent_task_id is null;

-- Alias for requests/tools that ask for the singular "task" table.
create or replace view public.task as
select * from public.tasks;

-- Flow reads/writes marketing leads with Vietnamese column names.
-- Seeding already writes leads with customer_* columns. Keep one table and sync both shapes.
alter table public.leads add column if not exists ho_ten text;
alter table public.leads add column if not exists so_dien_thoai text;
alter table public.leads add column if not exists nguon text;
alter table public.leads add column if not exists anh_nhu_cau_url text;
alter table public.leads add column if not exists trang_thai text;
alter table public.leads add column if not exists hop_le boolean;
alter table public.leads add column if not exists thu_nhap numeric not null default 0;
alter table public.leads add column if not exists la_trung boolean not null default false;
alter table public.leads add column if not exists phu_trach text references public.users(user_id) on delete set null;

create or replace function public.sync_flow_lead_fields()
returns trigger
language plpgsql
as $$
begin
    new.customer_name := coalesce(nullif(new.customer_name, ''), nullif(new.ho_ten, ''));
    new.customer_phone := coalesce(nullif(new.customer_phone, ''), nullif(new.so_dien_thoai, ''));
    new.ho_ten := coalesce(nullif(new.ho_ten, ''), nullif(new.customer_name, ''));
    new.so_dien_thoai := coalesce(nullif(new.so_dien_thoai, ''), nullif(new.customer_phone, ''));
    new.nguon := coalesce(nullif(new.nguon, ''), nullif(new.lead_source, ''), nullif(new.platform, ''), 'seeding');
    new.source_id := coalesce(nullif(new.source_id, ''), nullif(new.post_id, ''), nullif(new.comment_id, ''), nullif(new.group_id, ''));
    new.trang_thai := coalesce(nullif(new.trang_thai, ''), case when new.contact_status in ('lost', 'rejected') then 'unqualified' else 'qualified' end);
    new.hop_le := coalesce(new.hop_le, new.trang_thai = 'qualified');

    if new.phu_trach is null and nullif(new.created_by_staff_id, '') is not null then
        select u.user_id
        into new.phu_trach
        from public.users u
        where u.user_id = new.created_by_staff_id
           or lower(u.username) = lower(new.created_by_staff_username)
        limit 1;
    end if;

    if new.lead_key is null or new.lead_key = '' then
        new.lead_key := encode(
            digest(
                coalesce(new.customer_phone, '') || '|' ||
                coalesce(new.customer_name, '') || '|' ||
                coalesce(new.source_id, '') || '|' ||
                gen_random_uuid()::text,
                'sha1'
            ),
            'hex'
        );
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_sync_flow_lead_fields on public.leads;
create trigger trg_sync_flow_lead_fields
before insert or update on public.leads
for each row
execute function public.sync_flow_lead_fields();

update public.leads
set ho_ten = coalesce(ho_ten, customer_name),
    so_dien_thoai = coalesce(so_dien_thoai, customer_phone),
    nguon = coalesce(nguon, lead_source, platform, 'seeding'),
    trang_thai = coalesce(trang_thai, 'qualified'),
    hop_le = coalesce(hop_le, true)
where ho_ten is null
   or so_dien_thoai is null
   or nguon is null
   or trang_thai is null
   or hop_le is null;

-- One-way sync: seeding staff_users -> Flow/task users.
insert into public.users (user_id, full_name, username, phone, password, role, enabled, access_role)
select
    s.id,
    coalesce(nullif(s.name, ''), nullif(s.username, ''), s.id) as full_name,
    s.username,
    nullif(s.username, '') as phone,
    nullif(s.password, '') as password,
    coalesce(nullif(s.role, ''), 'staff') as role,
    coalesce(s.enabled, true) as enabled,
    case when lower(coalesce(s.role, '')) = 'admin' then 'admin' else 'worker' end as access_role
from public.staff_users s
on conflict (user_id) do update
set full_name = excluded.full_name,
    username = excluded.username,
    phone = coalesce(public.users.phone, excluded.phone),
    password = coalesce(public.users.password, excluded.password, '123456'),
    role = excluded.role,
    access_role = excluded.access_role,
    enabled = excluded.enabled,
    updated_at = now();

update public.users
set password = coalesce(nullif(password, ''), '123456'),
    access_role = coalesce(nullif(access_role, ''), case when lower(coalesce(role, '')) = 'admin' then 'admin' else 'worker' end),
    phone = coalesce(nullif(phone, ''), nullif(username, ''))
where password is null
   or password = ''
   or access_role is null
   or access_role = ''
   or phone is null
   or phone = '';

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.users to anon, authenticated, service_role;
grant select, insert, update, delete on public.access_roles to anon, authenticated, service_role;
grant select, insert, update, delete on public.role_permissions to anon, authenticated, service_role;
grant select, insert, update, delete on public.customers to anon, authenticated, service_role;
grant select, insert, update, delete on public.projects to anon, authenticated, service_role;
grant select, insert, update, delete on public.features to anon, authenticated, service_role;
grant select, insert, update, delete on public.tasks to anon, authenticated, service_role;
grant select on public.task to anon, authenticated, service_role;

alter table public.users enable row level security;
alter table public.access_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.features enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "users_all" on public.users;
create policy "users_all" on public.users for all to anon, authenticated using (true) with check (true);

drop policy if exists "access_roles_all" on public.access_roles;
create policy "access_roles_all" on public.access_roles for all to anon, authenticated using (true) with check (true);

drop policy if exists "role_permissions_all" on public.role_permissions;
create policy "role_permissions_all" on public.role_permissions for all to anon, authenticated using (true) with check (true);

drop policy if exists "customers_all" on public.customers;
create policy "customers_all" on public.customers for all to anon, authenticated using (true) with check (true);

drop policy if exists "projects_all" on public.projects;
create policy "projects_all" on public.projects for all to anon, authenticated using (true) with check (true);

drop policy if exists "features_all" on public.features;
create policy "features_all" on public.features for all to anon, authenticated using (true) with check (true);

drop policy if exists "tasks_all" on public.tasks;
create policy "tasks_all" on public.tasks for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';

select 'users' as table_name, count(*) as rows from public.users
union all select 'access_roles', count(*) from public.access_roles
union all select 'role_permissions', count(*) from public.role_permissions
union all select 'customers', count(*) from public.customers
union all select 'projects', count(*) from public.projects
union all select 'features', count(*) from public.features
union all select 'tasks', count(*) from public.tasks;

select
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in ('users', 'access_roles', 'role_permissions', 'customers', 'projects', 'features', 'tasks')
order by tablename, policyname;
