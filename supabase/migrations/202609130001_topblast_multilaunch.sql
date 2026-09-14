create extension if not exists pgcrypto;

create type public.launch_status as enum ('prepared', 'processing', 'active', 'paused', 'failed');
create type public.epoch_status as enum ('pending', 'running', 'failed', 'completed');
create type public.activity_kind as enum ('verified_buy', 'sell', 'incoming_transfer', 'outgoing_transfer');

create table public.launches (
  id uuid primary key default gen_random_uuid(),
  venue text not null check (venue = 'stonkfun'),
  creator_wallet text not null,
  name text not null,
  symbol text not null,
  description text not null default '',
  image_url text not null,
  website_url text,
  x_url text,
  telegram_url text,
  quote_mint text not null,
  quote_symbol text not null,
  mint text unique,
  market_address text unique,
  payment_signature text unique,
  launch_signature text unique,
  signed_quote_hash text not null,
  status public.launch_status not null default 'prepared',
  venue_payload jsonb not null default '{}'::jsonb,
  market_cap_usd numeric,
  volume_24h_usd numeric,
  liquidity_usd numeric,
  price_usd numeric,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.launch_configs (
  launch_id uuid primary key references public.launches(id) on delete restrict,
  fee_tier text not null check (fee_tier in ('1%', '2%')),
  topblast_percent smallint not null check (topblast_percent between 0 and 100),
  creator_percent smallint not null check (creator_percent between 0 and 100),
  protocol_percent smallint not null check (protocol_percent between 0 and 100),
  reward_asset_mint text not null,
  treasury_address text,
  immutable boolean not null default true,
  created_at timestamptz not null default now(),
  check (topblast_percent + creator_percent + protocol_percent = 100)
);

create table public.launch_creators (
  launch_id uuid not null references public.launches(id) on delete restrict,
  creator_wallet text not null,
  created_at timestamptz not null default now(),
  primary key (launch_id, creator_wallet)
);

create table public.tracked_markets (
  launch_id uuid primary key references public.launches(id) on delete restrict,
  venue text not null check (venue = 'stonkfun'),
  market_address text not null unique,
  base_mint text not null unique,
  quote_mint text not null,
  base_decimals smallint not null default 6,
  quote_decimals smallint not null default 9,
  last_indexed_slot bigint not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.wallet_positions (
  launch_id uuid not null references public.launches(id) on delete restrict,
  wallet text not null,
  verified_purchased_raw numeric(39,0) not null default 0 check (verified_purchased_raw >= 0),
  verified_remaining_raw numeric(39,0) not null default 0 check (verified_remaining_raw >= 0),
  balance_raw numeric(39,0) not null default 0 check (balance_raw >= 0),
  cost_basis_quote_atoms numeric(39,0) not null default 0 check (cost_basis_quote_atoms >= 0),
  previous_rewards_quote_atoms numeric(39,0) not null default 0 check (previous_rewards_quote_atoms >= 0),
  last_activity_slot bigint not null default 0,
  last_sell_slot bigint,
  last_outgoing_transfer_slot bigint,
  updated_at timestamptz not null default now(),
  primary key (launch_id, wallet),
  check (verified_remaining_raw <= verified_purchased_raw)
);

create table public.verified_buys (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  wallet text not null,
  signature text not null,
  instruction_index integer not null default 0,
  slot bigint not null,
  token_raw numeric(39,0) not null check (token_raw > 0),
  quote_atoms numeric(39,0) not null check (quote_atoms > 0),
  market_address text not null,
  created_at timestamptz not null default now(),
  unique (launch_id, signature, instruction_index)
);

create table public.wallet_activity (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  wallet text not null,
  signature text not null,
  event_index integer not null default 0,
  kind public.activity_kind not null,
  token_raw numeric(39,0) not null check (token_raw > 0),
  quote_atoms numeric(39,0),
  slot bigint not null,
  block_time timestamptz,
  created_at timestamptz not null default now(),
  unique (launch_id, signature, event_index, wallet, kind)
);

create table public.fee_events (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  asset_mint text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms >= 0),
  source text not null check (source in ('stonkfun_forward', 'creator_deposit', 'legacy_claim')),
  signature text,
  venue_intent_id text,
  status text not null check (status in ('detected', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  unique (launch_id, signature, asset_mint),
  unique (id, launch_id)
);

create table public.fee_allocations (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  fee_event_id uuid not null references public.fee_events(id) on delete restrict,
  topblast_atoms numeric(39,0) not null check (topblast_atoms >= 0),
  creator_atoms numeric(39,0) not null check (creator_atoms >= 0),
  protocol_atoms numeric(39,0) not null check (protocol_atoms >= 0),
  created_at timestamptz not null default now(),
  unique (launch_id, fee_event_id),
  unique (id, launch_id),
  foreign key (fee_event_id, launch_id) references public.fee_events(id, launch_id) on delete restrict
);

create table public.reward_epochs (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  sequence integer not null check (sequence > 0),
  status public.epoch_status not null default 'pending',
  reward_asset_mint text not null,
  start_slot bigint not null,
  snapshot_slot bigint,
  funded_budget_atoms numeric(39,0) not null default 0 check (funded_budget_atoms >= 0),
  distributed_atoms numeric(39,0) not null default 0 check (distributed_atoms >= 0),
  failed_step text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (launch_id, sequence),
  unique (id, launch_id),
  check (distributed_atoms <= funded_budget_atoms)
);

create table public.reward_snapshots (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  epoch_id uuid not null references public.reward_epochs(id) on delete restrict,
  wallet text not null,
  status text not null,
  average_entry_quote_atoms numeric(39,0) not null,
  current_value_quote_atoms numeric(39,0) not null,
  eligible_units_raw numeric(39,0) not null,
  eligible_loss_quote_atoms numeric(39,0) not null,
  previous_rewards_quote_atoms numeric(39,0) not null,
  created_at timestamptz not null default now(),
  unique (launch_id, epoch_id, wallet),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

create table public.reward_allocations (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  epoch_id uuid not null references public.reward_epochs(id) on delete restrict,
  wallet text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms >= 0),
  eligible_loss_quote_atoms numeric(39,0) not null check (eligible_loss_quote_atoms >= 0),
  created_at timestamptz not null default now(),
  unique (launch_id, epoch_id, wallet),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

create table public.reward_distributions (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  epoch_id uuid not null references public.reward_epochs(id) on delete restrict,
  wallet text not null,
  asset_mint text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms > 0),
  status text not null check (status in ('pending', 'submitted', 'confirmed', 'failed')),
  idempotency_key text not null unique,
  signature text,
  error_message text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (launch_id, epoch_id, wallet),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

create table public.transaction_proofs (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  epoch_id uuid references public.reward_epochs(id) on delete restrict,
  kind text not null check (kind in ('fee_claim', 'fee_forward', 'swap', 'distribution', 'snapshot')),
  signature text,
  slot bigint,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

create table public.protocol_revenue (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  fee_allocation_id uuid not null references public.fee_allocations(id) on delete restrict,
  asset_mint text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms >= 0),
  signature text,
  created_at timestamptz not null default now(),
  unique (launch_id, fee_allocation_id),
  foreign key (fee_allocation_id, launch_id) references public.fee_allocations(id, launch_id) on delete restrict
);

create table public.worker_steps (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  epoch_id uuid not null references public.reward_epochs(id) on delete restrict,
  step text not null,
  idempotency_key text not null unique,
  proof text,
  created_at timestamptz not null default now(),
  unique (launch_id, epoch_id, step),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

create table public.system_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.system_config (key, value) values
  ('reward_engine_paused', 'true'::jsonb),
  ('minimum_topblast_percent', '50'::jsonb),
  ('dry_run', 'true'::jsonb)
on conflict do nothing;

create index wallet_activity_launch_slot on public.wallet_activity (launch_id, slot);
create index wallet_positions_launch_status on public.wallet_positions (launch_id, last_activity_slot);
create index reward_epochs_launch_status on public.reward_epochs (launch_id, status);
create index fee_events_launch_status on public.fee_events (launch_id, status);

create or replace function public.prevent_immutable_update() returns trigger language plpgsql as $$
begin
  raise exception 'historical reward/proof rows are append-only';
end $$;

create trigger reward_snapshots_immutable before update or delete on public.reward_snapshots for each row execute function public.prevent_immutable_update();
create trigger reward_allocations_immutable before update or delete on public.reward_allocations for each row execute function public.prevent_immutable_update();
create trigger transaction_proofs_immutable before update or delete on public.transaction_proofs for each row execute function public.prevent_immutable_update();
create trigger launch_configs_immutable before update or delete on public.launch_configs for each row execute function public.prevent_immutable_update();

create or replace function public.apply_wallet_activity(
  p_launch_id uuid,
  p_wallet text,
  p_signature text,
  p_event_index integer,
  p_kind public.activity_kind,
  p_token_raw numeric,
  p_quote_atoms numeric,
  p_slot bigint
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  inserted_id uuid;
  current_position public.wallet_positions%rowtype;
  remove_verified numeric;
  remove_cost numeric;
begin
  if p_token_raw <= 0 then raise exception 'token amount must be positive'; end if;
  if p_kind = 'verified_buy' and (p_quote_atoms is null or p_quote_atoms <= 0) then
    raise exception 'verified buy requires quote amount';
  end if;
  insert into public.wallet_activity (launch_id, wallet, signature, event_index, kind, token_raw, quote_atoms, slot)
  values (p_launch_id, p_wallet, p_signature, p_event_index, p_kind, p_token_raw, p_quote_atoms, p_slot)
  on conflict do nothing returning id into inserted_id;
  if inserted_id is null then return false; end if;

  insert into public.wallet_positions (launch_id, wallet) values (p_launch_id, p_wallet)
  on conflict do nothing;
  select * into current_position from public.wallet_positions where launch_id = p_launch_id and wallet = p_wallet for update;

  if p_kind = 'verified_buy' then
    update public.wallet_positions set
      verified_purchased_raw = verified_purchased_raw + p_token_raw,
      verified_remaining_raw = verified_remaining_raw + p_token_raw,
      balance_raw = balance_raw + p_token_raw,
      cost_basis_quote_atoms = cost_basis_quote_atoms + p_quote_atoms,
      last_activity_slot = p_slot, updated_at = now()
    where launch_id = p_launch_id and wallet = p_wallet;
    insert into public.verified_buys (launch_id, wallet, signature, instruction_index, slot, token_raw, quote_atoms, market_address)
    select p_launch_id, p_wallet, p_signature, p_event_index, p_slot, p_token_raw, p_quote_atoms, market_address
    from public.tracked_markets where launch_id = p_launch_id on conflict do nothing;
  elsif p_kind = 'incoming_transfer' then
    update public.wallet_positions set balance_raw = balance_raw + p_token_raw,
      last_activity_slot = p_slot, updated_at = now()
    where launch_id = p_launch_id and wallet = p_wallet;
  else
    remove_verified := least(p_token_raw, current_position.verified_remaining_raw);
    remove_cost := case when current_position.verified_remaining_raw > 0
      then trunc(current_position.cost_basis_quote_atoms * remove_verified / current_position.verified_remaining_raw)
      else 0 end;
    update public.wallet_positions set
      balance_raw = greatest(0, balance_raw - p_token_raw),
      verified_remaining_raw = verified_remaining_raw - remove_verified,
      cost_basis_quote_atoms = greatest(0, cost_basis_quote_atoms - remove_cost),
      last_sell_slot = case when p_kind = 'sell' then p_slot else last_sell_slot end,
      last_outgoing_transfer_slot = case when p_kind = 'outgoing_transfer' then p_slot else last_outgoing_transfer_slot end,
      last_activity_slot = p_slot, updated_at = now()
    where launch_id = p_launch_id and wallet = p_wallet;
  end if;
  return true;
end $$;
revoke all on function public.apply_wallet_activity(uuid,text,text,integer,public.activity_kind,numeric,numeric,bigint) from public;
grant execute on function public.apply_wallet_activity(uuid,text,text,integer,public.activity_kind,numeric,numeric,bigint) to service_role;

create or replace view public.launch_explore with (security_invoker = true) as
select l.id, l.mint, l.name, l.symbol, l.quote_symbol, l.creator_wallet, l.market_cap_usd,
  l.volume_24h_usd, l.liquidity_usd, l.price_usd, l.created_at, l.status,
  coalesce(sum(case when d.status = 'confirmed' then d.amount_atoms else 0 end), 0) as total_rewarded_atoms,
  count(distinct case when s.status = 'ELIGIBLE' then s.wallet end) as eligible_wallets
from public.launches l
left join public.reward_distributions d on d.launch_id = l.id
left join public.reward_snapshots s on s.launch_id = l.id
where l.status in ('active', 'paused') and l.mint is not null
group by l.id;

alter table public.launches enable row level security;
alter table public.launch_configs enable row level security;
alter table public.launch_creators enable row level security;
alter table public.tracked_markets enable row level security;
alter table public.wallet_positions enable row level security;
alter table public.reward_epochs enable row level security;
alter table public.reward_snapshots enable row level security;
alter table public.reward_allocations enable row level security;
alter table public.reward_distributions enable row level security;
alter table public.transaction_proofs enable row level security;

create policy public_active_launches on public.launches for select using (status in ('active', 'paused'));
create policy public_launch_configs on public.launch_configs for select using (exists (select 1 from public.launches l where l.id = launch_id and l.status in ('active', 'paused')));
create policy public_reward_epochs on public.reward_epochs for select using (status = 'completed');
create policy public_reward_snapshots on public.reward_snapshots for select using (exists (select 1 from public.reward_epochs e where e.id = epoch_id and e.status = 'completed'));
create policy public_reward_allocations on public.reward_allocations for select using (exists (select 1 from public.reward_epochs e where e.id = epoch_id and e.status = 'completed'));
create policy public_reward_distributions on public.reward_distributions for select using (status = 'confirmed');
create policy public_transaction_proofs on public.transaction_proofs for select using (epoch_id is null or exists (select 1 from public.reward_epochs e where e.id = epoch_id and e.status = 'completed'));
