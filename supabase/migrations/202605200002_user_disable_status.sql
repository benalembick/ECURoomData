alter table public.profiles
add column if not exists is_disabled boolean not null default false;
