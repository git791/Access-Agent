create type run_status as enum ('queued', 'auditing', 'patching', 'verifying', 'completed', 'needs_review', 'failed');
create type finding_status as enum ('Found', 'Verified', 'Review');

create table runs (
  id uuid primary key,
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

alter table runs enable row level security;
alter table findings enable row level security;
-- The dashboard uses a server-side service-role client. Add authenticated-user policies before enabling direct client reads.

insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
on conflict (id) do nothing;
