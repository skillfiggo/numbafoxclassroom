create table public.classroom_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'teacher')),
  created_at timestamptz not null default now()
);

alter table public.classroom_roles enable row level security;
revoke all on public.classroom_roles from public, anon, authenticated;
grant select, insert, update, delete on public.classroom_roles to service_role;
