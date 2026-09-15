begin;
alter table public.funding_intents drop constraint if exists funding_intents_no_self_funding;
alter table public.funding_intents add constraint funding_intents_no_self_funding check (funder_wallet <> reward_treasury);
alter table public.launches drop constraint if exists launches_venue_check;
alter table public.launches add constraint launches_venue_check check (venue in ('stonkfun','pumpfun'));
alter table public.tracked_markets drop constraint if exists tracked_markets_venue_check;
alter table public.tracked_markets add constraint tracked_markets_venue_check check (venue in ('stonkfun','pumpfun'));
alter table public.price_observations drop constraint if exists price_observations_source_check;
alter table public.price_observations add constraint price_observations_source_check check (source in ('launchlab_pool','verified_swap','pump_curve'));
create table if not exists public.launch_metadata (
  id uuid primary key,
  metadata jsonb not null,
  image_data text not null,
  created_at timestamptz not null default now()
);
alter table public.launch_metadata enable row level security;
revoke all on public.launch_metadata from anon, authenticated;
revoke all on public.launch_metadata from service_role;
grant select, insert on public.launch_metadata to service_role;
commit;
