create table public.classroom_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  grade text not null check (grade in ('JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3', 'Graduate', 'Other')),
  exam text not null check (exam in ('JAMB', 'WAEC', 'NECO', 'School exams', 'General learning'))
);

create table public.classroom_room (
  id integer primary key check (id = 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);

create table public.classroom_visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null,
  visited_at timestamptz not null default now(),
  topic text not null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  working text not null,
  primary key (user_id, lesson_id)
);

create index classroom_visits_recent on public.classroom_visits (user_id, visited_at desc);

alter table public.classroom_profiles enable row level security;
alter table public.classroom_room enable row level security;
alter table public.classroom_visits enable row level security;

revoke all on public.classroom_profiles, public.classroom_room, public.classroom_visits
  from public, anon, authenticated, service_role;
grant select, insert, update on public.classroom_profiles to authenticated;
grant select on public.classroom_visits to authenticated;
grant select, insert, update on public.classroom_room, public.classroom_visits to service_role;

create policy classroom_profile_read on public.classroom_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy classroom_profile_create on public.classroom_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy classroom_profile_edit on public.classroom_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy classroom_visit_read on public.classroom_visits for select to authenticated
  using (user_id = (select auth.uid()));
