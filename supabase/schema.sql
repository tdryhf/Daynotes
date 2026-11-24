-- Daybook backend (applied to the "daynotes" Supabase project as migration daybook_schema_v2).
-- Run this whole file in the Supabase SQL editor to set up a fresh project. It is safe to re-run.
--
-- Design
-- * family_records: the shared family daybook. Anyone with the app link can read it, by design.
--   Writes only go through push_family_records(), which keeps whichever copy of each record was
--   edited last, so an older device can never overwrite newer changes. Edit times are capped at the
--   server's clock, and the app sets its edit times by server_now_ms(), so a wrong device clock
--   can't make an edit win or lose.
-- * private_journal / private_journal_photos: the private journal. Everything in them is encrypted
--   in the browser before it is sent. Writes need a "write token" derived from the journal's
--   encryption key, so only someone who can unlock the journal can change or delete it. Saves are
--   version-checked so two devices can't silently overwrite each other.

-- ---------------------------------------------------------------------------------------------
-- Shared family records

create table if not exists public.family_records (
  id text primary key check (char_length(id) between 1 and 200),
  record jsonb not null,
  updated_ms bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists family_records_updated_at_idx on public.family_records (updated_at, id);

alter table public.family_records enable row level security;
revoke all on public.family_records from anon, authenticated;
grant select on public.family_records to anon, authenticated;
drop policy if exists "Anyone can read family records" on public.family_records;
create policy "Anyone can read family records" on public.family_records for select to anon, authenticated using (true);

create or replace function public.push_family_records(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;
  if jsonb_array_length(payload) > 1000 then
    raise exception 'too many records in one request';
  end if;
  with valid as (
    select distinct on (r->>'id')
      r->>'id' as id,
      r as record,
      (r->>'updatedAt')::numeric as sent_ms
    from jsonb_array_elements(payload) as r
    where jsonb_typeof(r) = 'object'
      and jsonb_typeof(r->'id') = 'string'
      and char_length(r->>'id') between 1 and 200
      and jsonb_typeof(r->'type') = 'string'
      and (r->>'type') <> 'journal'
      and jsonb_typeof(r->'updatedAt') = 'number'
      and pg_column_size(r) <= 131072
    order by r->>'id', (r->>'updatedAt')::numeric desc
  ), clamped as (
    -- The edit time decides which copy wins. One later than the server's clock (a device whose clock
    -- runs fast, or a faulty client) would beat every real edit until that time arrived, so it is
    -- pulled back to now, and the stored record carries the corrected time so every device agrees.
    select id, record, sent_ms, floor(greatest(0, least(sent_ms, now_ms)))::bigint as stamp from valid
  ), incoming as (
    select id, stamp as updated_ms,
      case when sent_ms = stamp then record else jsonb_set(record, '{updatedAt}', to_jsonb(stamp)) end as record
    from clamped
  ), written as (
    insert into public.family_records as f (id, record, updated_ms, updated_at)
    select id, record, updated_ms, clock_timestamp() from incoming
    on conflict (id) do update
      set record = excluded.record, updated_ms = excluded.updated_ms, updated_at = clock_timestamp()
      where f.updated_ms < excluded.updated_ms
    returning 1
  )
  select count(*) into changed from written;
  return changed;
end;
$$;

-- Pulls back any edit time already stored ahead of the server's clock (saved before the check above).
with server_now as (select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as ms)
update public.family_records as f
  set updated_ms = server_now.ms, record = jsonb_set(f.record, '{updatedAt}', to_jsonb(server_now.ms)), updated_at = clock_timestamp()
  from server_now
  where f.updated_ms > server_now.ms;

-- The server's clock in milliseconds. The app measures how far the device's clock is from it, so
-- edit times still order correctly on a device whose clock is set wrong.
create or replace function public.server_now_ms()
returns bigint
language sql
volatile
set search_path = ''
as $$
  select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- ---------------------------------------------------------------------------------------------
-- Private journal (encrypted in the browser)

create table if not exists public.private_journal (
  id text primary key check (id = 'shared'),
  envelope jsonb not null,
  version bigint not null default 1,
  write_hash text not null,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.private_journal enable row level security;
revoke all on public.private_journal from anon, authenticated;
-- write_hash is deliberately not readable.
grant select (id, envelope, version, updated_at) on public.private_journal to anon, authenticated;
drop policy if exists "Anyone can read the encrypted journal" on public.private_journal;
create policy "Anyone can read the encrypted journal" on public.private_journal for select to anon, authenticated using (true);

create table if not exists public.private_journal_photos (
  id text primary key check (char_length(id) between 1 and 100),
  iv text not null,
  ciphertext text not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.private_journal_photos enable row level security;
revoke all on public.private_journal_photos from anon, authenticated;
grant select on public.private_journal_photos to anon, authenticated;
drop policy if exists "Anyone can read encrypted journal photos" on public.private_journal_photos;
create policy "Anyone can read encrypted journal photos" on public.private_journal_photos for select to anon, authenticated using (true);

create or replace function public.journal_envelope_valid(p_envelope jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_envelope is not null
    and jsonb_typeof(p_envelope) = 'object'
    and p_envelope ?& array['passwordSalt','passwordIv','wrappedKey','recoverySalt','recoveryIv','recoveryWrappedKey','contentIv','ciphertext']
    and pg_column_size(p_envelope) <= 8388608;
$$;
revoke all on function public.journal_envelope_valid(jsonb) from public, anon, authenticated;

create or replace function public.journal_create(p_envelope jsonb, p_write_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_write_token is null or char_length(p_write_token) < 32 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.journal_envelope_valid(p_envelope) then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.private_journal (id, envelope, version, write_hash, updated_at)
  values ('shared', p_envelope, 1, encode(sha256(convert_to(p_write_token, 'UTF8')), 'hex'), clock_timestamp())
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('status', 'exists');
  end if;
  return jsonb_build_object('status', 'ok', 'version', 1);
end;
$$;

create or replace function public.journal_save(p_expected_version bigint, p_envelope jsonb, p_write_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_hash text;
begin
  select version, write_hash into current_version, current_hash
  from public.private_journal where id = 'shared' for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if current_hash <> encode(sha256(convert_to(coalesce(p_write_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if current_version <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'version', current_version);
  end if;
  if not public.journal_envelope_valid(p_envelope) then
    return jsonb_build_object('status', 'invalid');
  end if;
  update public.private_journal
    set envelope = p_envelope, version = current_version + 1, updated_at = clock_timestamp()
    where id = 'shared';
  return jsonb_build_object('status', 'ok', 'version', current_version + 1);
end;
$$;

create or replace function public.journal_put_photo(p_write_token text, p_id text, p_iv text, p_ciphertext text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.private_journal
    where id = 'shared' and write_hash = encode(sha256(convert_to(coalesce(p_write_token, ''), 'UTF8')), 'hex')
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_id is null or char_length(p_id) not between 1 and 100 or p_iv is null or p_ciphertext is null
     or char_length(p_ciphertext) > 12582912 then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.private_journal_photos (id, iv, ciphertext)
  values (p_id, p_iv, p_ciphertext)
  on conflict (id) do nothing;
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.journal_delete_photos(p_write_token text, p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if not exists (
    select 1 from public.private_journal
    where id = 'shared' and write_hash = encode(sha256(convert_to(coalesce(p_write_token, ''), 'UTF8')), 'hex')
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  delete from public.private_journal_photos where id = any(coalesce(p_ids, array[]::text[]));
  get diagnostics removed = row_count;
  return jsonb_build_object('status', 'ok', 'removed', removed);
end;
$$;

-- The app calls these with the public (publishable) key. Each one validates its input itself.
revoke all on function public.push_family_records(jsonb) from public;
revoke all on function public.server_now_ms() from public;
revoke all on function public.journal_create(jsonb, text) from public;
revoke all on function public.journal_save(bigint, jsonb, text) from public;
revoke all on function public.journal_put_photo(text, text, text, text) from public;
revoke all on function public.journal_delete_photos(text, text[]) from public;
grant execute on function public.push_family_records(jsonb) to anon, authenticated;
grant execute on function public.server_now_ms() to anon, authenticated;
grant execute on function public.journal_create(jsonb, text) to anon, authenticated;
grant execute on function public.journal_save(bigint, jsonb, text) to anon, authenticated;
grant execute on function public.journal_put_photo(text, text, text, text) to anon, authenticated;
grant execute on function public.journal_delete_photos(text, text[]) to anon, authenticated;
