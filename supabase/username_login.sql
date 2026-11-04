-- ════════════════════════════════════════════════════════════════════
-- Tell Me. — sign in with a username OR an email
--
-- Supabase Auth only signs in by email. This script adds:
--   1. public.profiles: one unique (case-insensitive) username per account,
--      filled automatically from the username given at sign-up.
--   2. username_available(name): lets the sign-up form say "username taken".
--   3. email_for_login(identifier, password): turns a username into the
--      account's email ONLY when the password is correct, so it can't be used
--      to look up other people's email addresses.
--
-- Safe to run more than once. Run it in the Supabase dashboard → SQL Editor.
-- ════════════════════════════════════════════════════════════════════

-- bcrypt check (Supabase installs pgcrypto in the "extensions" schema)
create extension if not exists pgcrypto with schema extensions;

-- 1. Profiles ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Create the profile when an account is created. A duplicate username makes
-- sign-up fail (the app shows "That username is taken").
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  if uname is not null then
    insert into public.profiles (id, username) values (new.id, uname);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Existing accounts: copy the username they signed up with (first one wins on duplicates).
insert into public.profiles (id, username)
select id, trim(raw_user_meta_data ->> 'username')
from auth.users
where coalesce(trim(raw_user_meta_data ->> 'username'), '') <> ''
order by created_at
on conflict do nothing;

-- 2. Username availability ---------------------------------------------
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(trim(name)));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- 3. Username → email, only with the right password ----------------------
create or replace function public.email_for_login(identifier text, password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  found_email text;
  hash text;
begin
  select u.email, u.encrypted_password
    into found_email, hash
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(trim(identifier))
  limit 1;

  if hash is null or hash = '' then
    -- Do comparable work so response time doesn't reveal whether the username exists.
    perform crypt(password, gen_salt('bf'));
    return null;
  end if;

  if crypt(password, hash) = hash then
    return found_email;
  end if;
  return null;
end;
$$;

revoke all on function public.email_for_login(text, text) from public;
grant execute on function public.email_for_login(text, text) to anon, authenticated;
