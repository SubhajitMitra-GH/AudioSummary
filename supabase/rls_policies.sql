-- Row Level Security for Tell Me.
--
-- REVIEW BEFORE RUNNING. The real table definitions are not in this repo; this script assumes
-- the columns the app uses: sessions(id, user_id, ...), chat_messages(id, session_id, ...),
-- document_chunks(session_id, user_id, ...). Run it in the Supabase SQL editor.
--
-- Goal: each signed-in user can only see and change their own rows, and anonymous clients
-- (the public anon key) can see nothing. The backend now always calls Supabase with the
-- user's own token, so nothing in the app needs anonymous read access any more.
--
-- 1. First, list existing policies and drop any that grant access to `anon` or `public`:
--      select tablename, policyname, roles, cmd, qual
--      from pg_policies
--      where schemaname = 'public' and tablename in ('sessions', 'chat_messages', 'document_chunks');
--      -- drop policy "<name>" on public.<table>;

-- 2. Enable RLS (safe to re-run)
alter table public.sessions        enable row level security;
alter table public.chat_messages   enable row level security;
alter table public.document_chunks enable row level security;

-- 3. Owner-only policies. ::text casts make this work whether user_id is uuid or text.
drop policy if exists "sessions: owner full access" on public.sessions;
create policy "sessions: owner full access" on public.sessions
  for all to authenticated
  using      ((select auth.uid())::text = user_id::text)
  with check ((select auth.uid())::text = user_id::text);

drop policy if exists "chat_messages: session owner full access" on public.chat_messages;
create policy "chat_messages: session owner full access" on public.chat_messages
  for all to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = chat_messages.session_id and s.user_id::text = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public.sessions s
    where s.id = chat_messages.session_id and s.user_id::text = (select auth.uid())::text
  ));

-- Chunks are uploaded right after transcription, before the session row exists in the cloud,
-- so this policy checks only the chunk's own user_id.
drop policy if exists "document_chunks: owner full access" on public.document_chunks;
create policy "document_chunks: owner full access" on public.document_chunks
  for all to authenticated
  using      ((select auth.uid())::text = user_id::text)
  with check ((select auth.uid())::text = user_id::text);

-- 4. Verify: as an anonymous client this must return zero rows.
--      curl "$SUPABASE_URL/rest/v1/sessions?select=id" -H "apikey: $SUPABASE_ANON_KEY"
