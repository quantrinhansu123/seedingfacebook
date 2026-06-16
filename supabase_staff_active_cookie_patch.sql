-- Cookie Facebook đang dùng cho phiên quản lý (active_cookie_id).
alter table public.staff_users
  add column if not exists active_cookie_id text default '';
