-- "Time TBC" instead of a made-up start time, and a "Sold out" flag.
alter table events add column time_tbc boolean not null default false;
alter table events add column sold_out boolean not null default false;
-- Agents used to file unknown start times as 10:00 with "time not listed" in the description.
update events set time_tbc = true where description ilike '%time not listed%';

-- Fixes the freshness checker suggests; the owner applies or dismisses them in Admin → Submissions.
create table agent_fixes (
  id          uuid primary key default gen_random_uuid(),
  target      text not null check (target in ('event', 'place')),
  target_id   uuid not null,
  changes     jsonb not null,
  reason      text not null,
  source_url  text,
  status      text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  created_at  timestamptz not null default now()
);
create index agent_fixes_status_idx on agent_fixes (status, created_at);
