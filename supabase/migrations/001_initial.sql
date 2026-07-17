create type run_status as enum ('queued', 'auditing', 'patching', 'verifying', 'completed', 'needs_review', 'failed');
create type finding_status as enum ('Found', 'Verified', 'Review');

create table runs (
  id uuid primary key,
  owner_token text not null,
  target_url text not null,
  status run_status not null,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table findings (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs(id) on delete cascade,
  issue_id text not null,
  page_url text not null,
  title text not null,
  wcag text not null,
  impact text not null,
  helps text not null,
  selector text,
  status finding_status not null,
  before_evidence_url text,
  after_evidence_url text,
  verification_note text,
  unique(run_id, issue_id)
);

create table run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs(id) on delete cascade,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table patch_attempts (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs(id) on delete cascade,
  branch text not null,
  commit_sha text,
  attempt integer not null check (attempt between 1 and 3),
  files_changed jsonb not null,
  diff text not null,
  created_at timestamptz not null default now()
);

create table rescan_schedules (
  id uuid primary key default gen_random_uuid(),
  target_url text not null,
  owner_token text not null,
  max_pages integer not null default 5 check (max_pages between 1 and 15),
  max_depth integer not null default 2 check (max_depth between 0 and 2),
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table audit_rate_windows (
  bucket text primary key,
  count integer not null,
  expires_at timestamptz not null
);

create or replace function consume_audit_rate_limit(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
as $$
declare current_count integer;
begin
  insert into audit_rate_windows (bucket, count, expires_at)
  values (p_bucket, 1, now() + interval '1 hour')
  on conflict (bucket) do update
    set count = case when audit_rate_windows.expires_at <= now() then 1 else audit_rate_windows.count + 1 end,
        expires_at = case when audit_rate_windows.expires_at <= now() then now() + interval '1 hour' else audit_rate_windows.expires_at end
  returning count into current_count;
  return current_count <= p_limit;
end;
$$;

alter table runs enable row level security;
alter table findings enable row level security;
-- The dashboard uses a server-side service-role client. Add authenticated-user policies before enabling direct client reads.

insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
on conflict (id) do nothing;
