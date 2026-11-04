-- Row Level Security for Tell Me.
--
-- Safe to run more than once. Run it in the Supabase SQL editor (nothing highlighted, so the
-- whole script runs). Applied to the production project on 2026-11-02.
--
-- Rule: each signed-in user can only read and change their own rows. Anonymous clients (the
-- public anon key that ships inside the app) can see and change nothing. The backend always calls
-- Supabase with the user's own token, so nothing in the app needs anonymous access.

begin;

alter table public.sessions        enable row level security;
alter table public.chat_messages   enable row level security;
alter table public.document_chunks enable row level security;

-- 1. Remove the old permissive rules. They let ANYONE read every user's sessions and messages
--    and insert rows for any user. Permissive policies are OR'ed, so while these existed the
--    owner-only rules below had no effect.
drop policy if exists "Allow public read sessions"        on public.sessions;
drop policy if exists "Allow public insert sessions"      on public.sessions;
drop policy if exists "Allow public read chat_messages"   on public.chat_messages;
drop policy if exists "Allow public insert chat_messages" on public.chat_messages;

-- 2. Owner-only rules (recreated so the script is the single source of truth).
--    For anonymous requests auth.uid() is NULL, so these never match.
drop policy if exists "Users can manage their own sessions" on public.sessions;
create policy "Users can manage their own sessions" on public.sessions
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage messages in their own sessions" on public.chat_messages;
create policy "Users can manage messages in their own sessions" on public.chat_messages
  for all
  using (exists (
    select 1 from public.sessions
    where sessions.id = chat_messages.session_id and sessions.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.sessions
    where sessions.id = chat_messages.session_id and sessions.user_id = auth.uid()
  ));

-- Chunks are uploaded right after transcription, before the session row reaches the cloud,
-- so this rule checks only the chunk's own user_id.
drop policy if exists "Users can manage chunks" on public.document_chunks;
create policy "Users can manage chunks" on public.document_chunks
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;

-- Verify: this must list exactly the 3 "Users can manage ..." policies and nothing else.
--   select tablename, policyname, roles, cmd
--   from pg_policies
--   where schemaname = 'public' and tablename in ('sessions', 'chat_messages', 'document_chunks');
