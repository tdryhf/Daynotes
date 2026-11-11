-- Daybook's shared family store. This is intentionally public and passwordless.
-- Anyone who can reach the app or database can read and change family_records.
create table if not exists public.family_records (
  id text primary key,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.family_records enable row level security;

drop policy if exists "Anyone can read family records" on public.family_records;
create policy "Anyone can read family records"
  on public.family_records for select to anon, authenticated
  using (true);

drop policy if exists "Anyone can add family records" on public.family_records;
create policy "Anyone can add family records"
  on public.family_records for insert to anon, authenticated
  with check (true);

drop policy if exists "Anyone can update family records" on public.family_records;
create policy "Anyone can update family records"
  on public.family_records for update to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.family_records to anon, authenticated;

-- Journal content is encrypted in the browser before this row is written.
-- The public policies support the app's passwordless shared-family setup.
create table if not exists public.private_journal (
  id text primary key check (id = 'shared'),
  envelope jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.private_journal enable row level security;

drop policy if exists "Anyone can read encrypted journal envelope" on public.private_journal;
create policy "Anyone can read encrypted journal envelope"
  on public.private_journal for select to anon, authenticated
  using (true);

drop policy if exists "Anyone can add encrypted journal envelope" on public.private_journal;
create policy "Anyone can add encrypted journal envelope"
  on public.private_journal for insert to anon, authenticated
  with check (true);

drop policy if exists "Anyone can update encrypted journal envelope" on public.private_journal;
create policy "Anyone can update encrypted journal envelope"
  on public.private_journal for update to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.private_journal to anon, authenticated;
