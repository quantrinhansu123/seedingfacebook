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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create table if not exists public.customers (
    customer_id  uuid primary key default gen_random_uuid(),
    name         text not null,
    phone        text,
    email        text,
    address      text,
    user_id      text references public.users(user_id) on delete set null,
    department   text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

alter table public.customers add column if not exists address text;
alter table public.customers add column if not exists user_id text references public.users(user_id) on delete set null;

create table if not exists public.projects (
    project_id      uuid primary key default gen_random_uuid(),
    name            text not null,
    pricing         numeric not null default 0,
    status          text not null default 'active',
    owner_user_id   text references public.users(user_id) on delete set null,
    deadline        timestamptz,
    description     text,
    assignees       text[] not null default '{}'::text[],
    content_blocks  jsonb not null default '{}'::jsonb,
    documents       jsonb not null default '[]'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

alter table public.projects add column if not exists customer_id uuid references public.customers(customer_id) on delete set null;
alter table public.projects add column if not exists deadline timestamptz;
alter table public.projects add column if not exists description text;
alter table public.projects add column if not exists assignees text[] not null default '{}'::text[];

-- Legacy finance / ticket modules used by BA, CS and Dashboard pages.
create table if not exists public.income_rate_config (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(project_id) on delete cascade,
    bo_phan     text not null check (bo_phan in ('marketing', 'sale', 'ba', 'product', 'dev', 'cs')),
    ty_le       numeric(5,2) not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (project_id, bo_phan)
);

create table if not exists public.point_config (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(project_id) on delete cascade,
    loai_ticket text not null,
    bo_phan     text not null check (bo_phan in ('dev', 'cs')),
    diem        int not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (project_id, bo_phan, loai_ticket)
);

create table if not exists public.amc_payments (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references public.projects(project_id) on delete cascade,
    nam_thu         int not null default 1,
    phan_sale       numeric not null default 0,
    phan_cs         numeric not null default 0,
    phan_dev        numeric not null default 0,
    phan_product    numeric not null default 0,
    phan_cong_ty    numeric not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (project_id, nam_thu)
);

create table if not exists public.tickets (
    id                    uuid primary key default gen_random_uuid(),
    ma_ticket             text not null unique,
    tieu_de               text not null,
    project_id            uuid references public.projects(project_id) on delete set null,
    loai                  text,
    bo_phan               text not null,
    phu_trach             text references public.users(user_id) on delete set null,
    trang_thai            text not null default 'pending',
    khach_xac_nhan        boolean not null default false,
    loi_sau_trien_khai    boolean not null default false,
    thu_nhap              numeric not null default 0,
    diem                  int not null default 0,
    so_lan_reopen         int not null default 0,
    bug_do_dev            boolean not null default false,
    co_tai_lieu           boolean not null default false,
    hop_le                boolean not null default false,
    do_uu_tien            text not null default 'medium',
    tai_lieu_url          text,
    mo_ta                 text,
    content_blocks        jsonb not null default '{}'::jsonb,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create table if not exists public.ticket_payment_stages (
    id          uuid primary key default gen_random_uuid(),
    ticket_id   uuid not null references public.tickets(id) on delete cascade,
    giai_doan   text not null,
    da_tra      boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (ticket_id, giai_doan)
);

drop trigger if exists trg_income_rate_config_updated_at on public.income_rate_config;
create trigger trg_income_rate_config_updated_at
before update on public.income_rate_config
for each row
execute function public.set_updated_at();

drop trigger if exists trg_point_config_updated_at on public.point_config;
create trigger trg_point_config_updated_at
before update on public.point_config
for each row
execute function public.set_updated_at();

drop trigger if exists trg_amc_payments_updated_at on public.amc_payments;
create trigger trg_amc_payments_updated_at
before update on public.amc_payments
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tickets_updated_at on public.tickets;
create trigger trg_tickets_updated_at
before update on public.tickets
for each row
execute function public.set_updated_at();

drop trigger if exists trg_ticket_payment_stages_updated_at on public.ticket_payment_stages;
create trigger trg_ticket_payment_stages_updated_at
before update on public.ticket_payment_stages
for each row
execute function public.set_updated_at();

create or replace function public.seed_ticket_payment_stages()
returns trigger
language plpgsql
as $$
begin
    insert into public.ticket_payment_stages (ticket_id, giai_doan, da_tra)
    values
        (new.id, 'done', false),
        (new.id, 'acceptance', false),
        (new.id, 'golive', false)
    on conflict (ticket_id, giai_doan) do nothing;
    return new;
end;
$$;

drop trigger if exists trg_seed_ticket_payment_stages on public.tickets;
create trigger trg_seed_ticket_payment_stages
after insert on public.tickets
for each row
execute function public.seed_ticket_payment_stages();

insert into public.ticket_payment_stages (ticket_id, giai_doan, da_tra)
select t.id, s.giai_doan, false
from public.tickets t
cross join (values ('done'), ('acceptance'), ('golive')) as s(giai_doan)
left join public.ticket_payment_stages tps
  on tps.ticket_id = t.id and tps.giai_doan = s.giai_doan
where tps.ticket_id is null;

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
create index if not exists idx_customers_user_id on public.customers(user_id);
create index if not exists idx_income_rate_config_project_id on public.income_rate_config(project_id);
create index if not exists idx_point_config_project_id on public.point_config(project_id);
create index if not exists idx_amc_payments_project_id on public.amc_payments(project_id);
create index if not exists idx_tickets_bo_phan on public.tickets(bo_phan);
create index if not exists idx_tickets_trang_thai on public.tickets(trang_thai);
create index if not exists idx_tickets_phu_trach on public.tickets(phu_trach);
create index if not exists idx_tickets_project_id on public.tickets(project_id);
create index if not exists idx_ticket_payment_stages_ticket_id on public.ticket_payment_stages(ticket_id);

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
grant select, insert, update, delete on public.income_rate_config to anon, authenticated, service_role;
grant select, insert, update, delete on public.point_config to anon, authenticated, service_role;
grant select, insert, update, delete on public.amc_payments to anon, authenticated, service_role;
grant select, insert, update, delete on public.tickets to anon, authenticated, service_role;
grant select, insert, update, delete on public.ticket_payment_stages to anon, authenticated, service_role;
grant select, insert, update, delete on public.features to anon, authenticated, service_role;
grant select, insert, update, delete on public.tasks to anon, authenticated, service_role;
grant select on public.task to anon, authenticated, service_role;

alter table public.users enable row level security;
alter table public.access_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.income_rate_config enable row level security;
alter table public.point_config enable row level security;
alter table public.amc_payments enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_payment_stages enable row level security;
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

drop policy if exists "income_rate_config_all" on public.income_rate_config;
create policy "income_rate_config_all" on public.income_rate_config for all to anon, authenticated using (true) with check (true);

drop policy if exists "point_config_all" on public.point_config;
create policy "point_config_all" on public.point_config for all to anon, authenticated using (true) with check (true);

drop policy if exists "amc_payments_all" on public.amc_payments;
create policy "amc_payments_all" on public.amc_payments for all to anon, authenticated using (true) with check (true);

drop policy if exists "tickets_all" on public.tickets;
create policy "tickets_all" on public.tickets for all to anon, authenticated using (true) with check (true);

drop policy if exists "ticket_payment_stages_all" on public.ticket_payment_stages;
create policy "ticket_payment_stages_all" on public.ticket_payment_stages for all to anon, authenticated using (true) with check (true);

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
union all select 'income_rate_config', count(*) from public.income_rate_config
union all select 'point_config', count(*) from public.point_config
union all select 'amc_payments', count(*) from public.amc_payments
union all select 'tickets', count(*) from public.tickets
union all select 'ticket_payment_stages', count(*) from public.ticket_payment_stages
union all select 'features', count(*) from public.features
union all select 'tasks', count(*) from public.tasks;

select
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'users', 'access_roles', 'role_permissions', 'customers', 'projects',
    'income_rate_config', 'point_config', 'amc_payments', 'tickets',
    'ticket_payment_stages', 'features', 'tasks'
  )
order by tablename, policyname;
