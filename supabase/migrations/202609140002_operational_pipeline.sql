-- Apply after 202609140001_audit_hardening.sql.
-- Durable multi-launch funding, indexing, pricing, worker leases and payouts.

alter table public.launches
  add column if not exists tracker_status text not null default 'pending'
    check (tracker_status in ('pending','registering','active','failed','paused')),
  add column if not exists tracker_error text,
  add column if not exists quote_expires_at timestamptz,
  add column if not exists payment_message_hash text;

create table if not exists public.launch_submission_receipts (
  launch_id uuid primary key references public.launches(id) on delete restrict,
  signed_quote text not null,
  unsigned_payment_transaction text not null,
  payment_message_hash text not null,
  signed_payment_transaction text,
  payment_signature text unique,
  status text not null default 'prepared' check (status in ('prepared','bound','submitted','processing','completed','failed')),
  attempts integer not null default 0 check (attempts>=0),
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tracked_markets
  add column if not exists program_id text,
  add column if not exists launch_slot bigint,
  add column if not exists launch_signature text,
  add column if not exists last_indexed_blockhash text,
  add column if not exists config_address text,
  add column if not exists platform_config_address text,
  add column if not exists authority_address text,
  add column if not exists creator_address text,
  add column if not exists base_vault text,
  add column if not exists quote_vault text,
  add column if not exists base_token_program text,
  add column if not exists quote_token_program text,
  add column if not exists history_complete boolean not null default false,
  add column if not exists price_status text not null default 'pending'
    check (price_status in ('pending','fresh','stale','failed')),
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists tracker_error text;

create table if not exists public.chain_event_inbox (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  signature text not null,
  observed_slot bigint,
  payload jsonb,
  source text not null check (source in ('helius_webhook','rpc_backfill')),
  status text not null default 'pending' check (status in ('pending','processing','confirmed','ignored','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (launch_id, signature),
  unique (id, launch_id)
);

create index if not exists chain_event_inbox_pending
  on public.chain_event_inbox (status, next_attempt_at, observed_slot, received_at);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  market_address text not null,
  slot bigint not null,
  block_time timestamptz not null,
  price_quote_atoms_per_token numeric(39,0) not null check (price_quote_atoms_per_token > 0),
  source text not null check (source in ('launchlab_pool','verified_swap')),
  payload_hash text not null,
  created_at timestamptz not null default now(),
  unique (launch_id, slot, source),
  unique (id, launch_id)
);

create index if not exists price_observations_launch_time
  on public.price_observations (launch_id, block_time desc);

create table if not exists public.funding_intents (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  funder_wallet text not null,
  asset_mint text not null,
  gross_amount_atoms numeric(39,0) not null check (gross_amount_atoms > 0),
  reward_amount_atoms numeric(39,0) not null check (reward_amount_atoms >= 0),
  creator_amount_atoms numeric(39,0) not null check (creator_amount_atoms >= 0),
  protocol_amount_atoms numeric(39,0) not null check (protocol_amount_atoms >= 0),
  reward_treasury text not null,
  protocol_treasury text,
  memo text not null unique,
  unsigned_transaction text not null,
  unsigned_message_hash text not null,
  signed_transaction text,
  last_valid_block_height bigint not null,
  status text not null default 'prepared' check (status in ('prepared','submitted','confirmed','expired','failed','uncertain')),
  signature text unique,
  error_message text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, launch_id),
  check (reward_amount_atoms + creator_amount_atoms + protocol_amount_atoms = gross_amount_atoms)
);

create table if not exists public.funding_deposits (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  intent_id uuid not null references public.funding_intents(id) on delete restrict,
  signature text not null unique,
  sender_wallet text not null,
  recipient_wallet text not null,
  asset_mint text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms > 0),
  gross_amount_atoms numeric(39,0) not null check (gross_amount_atoms >= amount_atoms),
  protocol_amount_atoms numeric(39,0) not null check (protocol_amount_atoms >= 0),
  slot bigint not null,
  block_time timestamptz not null,
  proof jsonb not null,
  created_at timestamptz not null default now(),
  unique (intent_id, launch_id),
  foreign key (intent_id, launch_id) references public.funding_intents(id, launch_id) on delete restrict
);

create table if not exists public.launch_funding_balances (
  launch_id uuid primary key references public.launches(id) on delete restrict,
  asset_mint text not null,
  available_atoms numeric(39,0) not null default 0 check (available_atoms >= 0),
  reserved_atoms numeric(39,0) not null default 0 check (reserved_atoms >= 0),
  submitted_atoms numeric(39,0) not null default 0 check (submitted_atoms >= 0),
  paid_atoms numeric(39,0) not null default 0 check (paid_atoms >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.funding_ledger (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  asset_mint text not null,
  kind text not null check (kind in ('credit','reserve','release','submit','pay')),
  amount_atoms numeric(39,0) not null check (amount_atoms > 0),
  deposit_id uuid references public.funding_deposits(id) on delete restrict,
  epoch_id uuid references public.reward_epochs(id) on delete restrict,
  payout_batch_id uuid,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

alter table public.reward_epochs
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists reference_price_quote_atoms numeric(39,0),
  add column if not exists price_observation_slot bigint,
  add column if not exists history_complete boolean not null default false,
  add column if not exists allocation_hash text;

create table if not exists public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  epoch_id uuid not null references public.reward_epochs(id) on delete restrict,
  sequence integer not null check (sequence >= 0),
  attempt integer not null default 0 check (attempt >= 0),
  asset_mint text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms > 0),
  status text not null default 'planned' check (status in ('planned','prepared','signed','submitted','uncertain','confirmed','failed')),
  manifest jsonb not null,
  manifest_hash text not null,
  unsigned_transaction text,
  unsigned_message_hash text,
  signed_transaction text,
  signature text unique,
  last_valid_block_height bigint,
  prepared_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (launch_id, epoch_id, sequence),
  unique (id, launch_id),
  foreign key (epoch_id, launch_id) references public.reward_epochs(id, launch_id) on delete restrict
);

alter table public.funding_ledger
  add constraint funding_ledger_payout_batch_fk foreign key (payout_batch_id, launch_id)
    references public.payout_batches(id, launch_id) on delete restrict;

alter table public.reward_distributions
  add column if not exists payout_batch_id uuid,
  add constraint reward_distributions_batch_fk foreign key (payout_batch_id, launch_id)
    references public.payout_batches(id, launch_id) on delete restrict;

create table if not exists public.worker_leases (
  resource_type text not null,
  resource_id text not null,
  owner_id text not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (resource_type, resource_id)
);

create or replace function public.rebuild_wallet_position(p_launch_id uuid, p_wallet text)
returns void language plpgsql security definer set search_path = public as $$
declare
  row record;
  purchased numeric := 0;
  remaining numeric := 0;
  balance numeric := 0;
  basis numeric := 0;
  removed numeric;
  removed_basis numeric;
  last_slot bigint := 0;
  sell_slot bigint := null;
  transfer_slot bigint := null;
  rewards numeric := 0;
begin
  select coalesce(max(previous_rewards_quote_atoms),0) into rewards
    from public.wallet_positions where launch_id=p_launch_id and wallet=p_wallet;
  for row in
    select * from public.wallet_activity
    where launch_id=p_launch_id and wallet=p_wallet
    order by slot, event_index, signature, kind
  loop
    last_slot := greatest(last_slot,row.slot);
    if row.kind='verified_buy' then
      purchased := purchased + row.token_raw;
      remaining := remaining + row.token_raw;
      balance := balance + row.token_raw;
      basis := basis + row.quote_atoms;
    elsif row.kind='incoming_transfer' then
      balance := balance + row.token_raw;
    else
      removed := least(row.token_raw,remaining);
      removed_basis := case when remaining>0 then trunc(basis*removed/remaining) else 0 end;
      remaining := remaining-removed;
      basis := greatest(0,basis-removed_basis);
      balance := greatest(0,balance-row.token_raw);
      if row.kind='sell' then sell_slot := greatest(coalesce(sell_slot,0),row.slot); end if;
      if row.kind='outgoing_transfer' then transfer_slot := greatest(coalesce(transfer_slot,0),row.slot); end if;
    end if;
  end loop;
  insert into public.wallet_positions (
    launch_id,wallet,verified_purchased_raw,verified_remaining_raw,balance_raw,
    cost_basis_quote_atoms,previous_rewards_quote_atoms,last_activity_slot,
    last_sell_slot,last_outgoing_transfer_slot,updated_at
  ) values (
    p_launch_id,p_wallet,purchased,remaining,balance,basis,rewards,last_slot,
    sell_slot,transfer_slot,now()
  ) on conflict (launch_id,wallet) do update set
    verified_purchased_raw=excluded.verified_purchased_raw,
    verified_remaining_raw=excluded.verified_remaining_raw,
    balance_raw=excluded.balance_raw,
    cost_basis_quote_atoms=excluded.cost_basis_quote_atoms,
    last_activity_slot=excluded.last_activity_slot,
    last_sell_slot=excluded.last_sell_slot,
    last_outgoing_transfer_slot=excluded.last_outgoing_transfer_slot,
    updated_at=now();
end $$;

create or replace function public.apply_wallet_activity(
  p_launch_id uuid, p_wallet text, p_signature text, p_event_index integer,
  p_kind public.activity_kind, p_token_raw numeric, p_quote_atoms numeric, p_slot bigint
) returns boolean language plpgsql security definer set search_path = public as $$
declare inserted_id uuid;
begin
  if p_token_raw<=0 then raise exception 'token amount must be positive'; end if;
  if p_kind='verified_buy' and (p_quote_atoms is null or p_quote_atoms<=0) then raise exception 'verified buy requires quote amount'; end if;
  insert into public.wallet_activity (launch_id,wallet,signature,event_index,kind,token_raw,quote_atoms,slot)
    values (p_launch_id,p_wallet,p_signature,p_event_index,p_kind,p_token_raw,p_quote_atoms,p_slot)
    on conflict do nothing returning id into inserted_id;
  if inserted_id is null then return false; end if;
  if p_kind='verified_buy' then
    insert into public.verified_buys (launch_id,wallet,signature,instruction_index,slot,token_raw,quote_atoms,market_address)
      select p_launch_id,p_wallet,p_signature,p_event_index,p_slot,p_token_raw,p_quote_atoms,market_address
      from public.tracked_markets where launch_id=p_launch_id on conflict do nothing;
  end if;
  perform public.rebuild_wallet_position(p_launch_id,p_wallet);
  return true;
end $$;

create or replace function public.claim_worker_lease(
  p_resource_type text, p_resource_id text, p_owner_id text, p_seconds integer default 60
) returns boolean language plpgsql security definer set search_path=public as $$
declare claimed boolean;
begin
  if p_seconds<10 or p_seconds>600 then raise exception 'invalid lease duration'; end if;
  insert into public.worker_leases(resource_type,resource_id,owner_id,expires_at)
    values(p_resource_type,p_resource_id,p_owner_id,now()+make_interval(secs=>p_seconds))
    on conflict(resource_type,resource_id) do update set
      owner_id=excluded.owner_id,acquired_at=now(),heartbeat_at=now(),expires_at=excluded.expires_at
      where public.worker_leases.expires_at<now() or public.worker_leases.owner_id=p_owner_id
    returning true into claimed;
  return coalesce(claimed,false);
end $$;

create or replace function public.bind_launch_payment(p_launch_id uuid,p_signature text,p_signed_transaction text)
returns boolean language plpgsql security definer set search_path=public as $$
declare l public.launches%rowtype; r public.launch_submission_receipts%rowtype;
begin
  select * into l from public.launches where id=p_launch_id for update;
  if not found then raise exception 'launch not found'; end if;
  select * into r from public.launch_submission_receipts where launch_id=p_launch_id for update;
  if not found then raise exception 'launch submission receipt not found'; end if;
  if l.payment_signature is not null and l.payment_signature<>p_signature then raise exception 'another payment is already bound to this launch'; end if;
  if r.payment_signature is not null and r.payment_signature<>p_signature then raise exception 'another signed transaction is already bound to this launch'; end if;
  if l.status not in ('prepared','processing') then raise exception 'launch is already %',l.status; end if;
  update public.launches set payment_signature=p_signature,status='processing',updated_at=now() where id=p_launch_id;
  update public.launch_submission_receipts set payment_signature=p_signature,signed_payment_transaction=p_signed_transaction,
    status=case when status='prepared' then 'bound' else status end,updated_at=now() where launch_id=p_launch_id;
  return r.payment_signature is null;
end $$;

create or replace function public.confirm_funding_deposit(
  p_intent_id uuid, p_signature text, p_slot bigint, p_block_time timestamptz, p_proof jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare i public.funding_intents%rowtype; inserted_id uuid;
begin
  select * into i from public.funding_intents where id=p_intent_id for update;
  if not found then raise exception 'funding intent not found'; end if;
  if i.status='confirmed' then return false; end if;
  if i.signature is distinct from p_signature then raise exception 'funding signature mismatch'; end if;
  insert into public.funding_deposits(launch_id,intent_id,signature,sender_wallet,recipient_wallet,asset_mint,amount_atoms,gross_amount_atoms,protocol_amount_atoms,slot,block_time,proof)
    values(i.launch_id,i.id,p_signature,i.funder_wallet,i.reward_treasury,i.asset_mint,i.reward_amount_atoms,i.gross_amount_atoms,i.protocol_amount_atoms,p_slot,p_block_time,p_proof)
    on conflict do nothing returning id into inserted_id;
  if inserted_id is null then return false; end if;
  insert into public.launch_funding_balances(launch_id,asset_mint,available_atoms)
    values(i.launch_id,i.asset_mint,i.reward_amount_atoms)
    on conflict(launch_id) do update set
      available_atoms=public.launch_funding_balances.available_atoms+excluded.available_atoms,
      updated_at=now();
  insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,deposit_id,idempotency_key)
    values(i.launch_id,i.asset_mint,'credit',i.reward_amount_atoms,inserted_id,'deposit:'||p_signature);
  update public.funding_intents set status='confirmed',updated_at=now() where id=i.id;
  return true;
end $$;

create or replace function public.reserve_epoch_budget(
  p_launch_id uuid, p_start_slot bigint, p_snapshot_slot bigint,
  p_start_time timestamptz, p_end_time timestamptz, p_price numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare b public.launch_funding_balances%rowtype; cfg public.launch_configs%rowtype; epoch_id uuid; seq integer; amount numeric;
begin
  select * into b from public.launch_funding_balances where launch_id=p_launch_id for update;
  if not found or b.available_atoms<=0 then return null; end if;
  select * into cfg from public.launch_configs where launch_id=p_launch_id;
  if not found then raise exception 'launch configuration not found'; end if;
  amount:=b.available_atoms;
  select coalesce(max(sequence),0)+1 into seq from public.reward_epochs where launch_id=p_launch_id;
  insert into public.reward_epochs(launch_id,sequence,status,reward_asset_mint,start_slot,snapshot_slot,funded_budget_atoms,start_time,end_time,reference_price_quote_atoms,price_observation_slot,history_complete,started_at)
    values(p_launch_id,seq,'running',cfg.reward_asset_mint,p_start_slot,p_snapshot_slot,amount,p_start_time,p_end_time,p_price,p_snapshot_slot,true,now()) returning id into epoch_id;
  update public.launch_funding_balances set available_atoms=available_atoms-amount,reserved_atoms=reserved_atoms+amount,updated_at=now() where launch_id=p_launch_id;
  insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,epoch_id,idempotency_key)
    values(p_launch_id,cfg.reward_asset_mint,'reserve',amount,epoch_id,'epoch-reserve:'||epoch_id::text);
  return epoch_id;
end $$;

create or replace function public.release_empty_epoch(p_epoch_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare e public.reward_epochs%rowtype;
begin
  select * into e from public.reward_epochs where id=p_epoch_id for update;
  if not found then raise exception 'epoch not found'; end if;
  if e.status='completed' then return false; end if;
  if exists(select 1 from public.reward_allocations where epoch_id=e.id and amount_atoms>0) then raise exception 'epoch has payable allocations'; end if;
  update public.launch_funding_balances set reserved_atoms=reserved_atoms-e.funded_budget_atoms,
    available_atoms=available_atoms+e.funded_budget_atoms,updated_at=now() where launch_id=e.launch_id;
  insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,epoch_id,idempotency_key)
    values(e.launch_id,e.reward_asset_mint,'release',e.funded_budget_atoms,e.id,'epoch-release:'||e.id::text)
    on conflict do nothing;
  update public.reward_epochs set status='completed',distributed_atoms=0,completed_at=now() where id=e.id;
  insert into public.transaction_proofs(launch_id,epoch_id,kind,slot,payload,idempotency_key)
    values(e.launch_id,e.id,'snapshot',e.snapshot_slot,jsonb_build_object('allocationHash',e.allocation_hash,'distributedAtoms','0','reason','no eligible wallets'),'snapshot:'||e.id::text)
    on conflict do nothing;
  return true;
end $$;

create or replace function public.submit_payout_batch(
  p_batch_id uuid, p_signature text, p_signed_transaction text
) returns boolean language plpgsql security definer set search_path=public as $$
declare b public.payout_batches%rowtype;
begin
  select * into b from public.payout_batches where id=p_batch_id for update;
  if not found then raise exception 'payout batch not found'; end if;
  if b.status in ('submitted','uncertain','confirmed') then
    if b.signature is distinct from p_signature then raise exception 'payout signature mismatch'; end if;
    return false;
  end if;
  if b.status<>'prepared' then raise exception 'payout batch is not prepared'; end if;
  update public.launch_funding_balances set reserved_atoms=reserved_atoms-b.amount_atoms,
    submitted_atoms=submitted_atoms+b.amount_atoms,updated_at=now()
    where launch_id=b.launch_id and reserved_atoms>=b.amount_atoms;
  if not found then raise exception 'reserved launch funding is insufficient'; end if;
  update public.payout_batches set status='submitted',signature=p_signature,signed_transaction=p_signed_transaction,
    submitted_at=now(),updated_at=now() where id=b.id;
  update public.reward_distributions set status='submitted',signature=p_signature where payout_batch_id=b.id;
  insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,epoch_id,payout_batch_id,idempotency_key)
    values(b.launch_id,b.asset_mint,'submit',b.amount_atoms,b.epoch_id,b.id,'payout-submit:'||b.id::text||':'||p_signature);
  return true;
end $$;

create or replace function public.expire_payout_batch(p_batch_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare b public.payout_batches%rowtype; old_signature text;
begin
  select * into b from public.payout_batches where id=p_batch_id for update;
  if not found then raise exception 'payout batch not found'; end if;
  if b.status not in ('submitted','uncertain') then return false; end if;
  old_signature:=b.signature;
  update public.launch_funding_balances set submitted_atoms=submitted_atoms-b.amount_atoms,
    reserved_atoms=reserved_atoms+b.amount_atoms,updated_at=now()
    where launch_id=b.launch_id and submitted_atoms>=b.amount_atoms;
  if not found then raise exception 'submitted launch funding is insufficient'; end if;
  update public.reward_distributions set status='pending',signature=null,error_message=null where payout_batch_id=b.id;
  update public.payout_batches set status='planned',attempt=attempt+1,unsigned_transaction=null,unsigned_message_hash=null,
    signed_transaction=null,signature=null,last_valid_block_height=null,prepared_at=null,submitted_at=null,error_message=null,updated_at=now()
    where id=b.id;
  insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,epoch_id,payout_batch_id,idempotency_key)
    values(b.launch_id,b.asset_mint,'release',b.amount_atoms,b.epoch_id,b.id,'payout-expire:'||b.id::text||':'||old_signature);
  return true;
end $$;

create or replace function public.confirm_payout_batch(p_batch_id uuid,p_slot bigint,p_proof jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare b public.payout_batches%rowtype; total numeric;
begin
  select * into b from public.payout_batches where id=p_batch_id for update;
  if not found then raise exception 'payout batch not found'; end if;
  if b.status='confirmed' then return false; end if;
  if b.status not in ('submitted','uncertain') then raise exception 'payout batch was not submitted'; end if;
  select coalesce(sum(amount_atoms),0) into total from public.reward_distributions where payout_batch_id=b.id;
  if total<>b.amount_atoms then raise exception 'payout manifest total mismatch'; end if;
  update public.launch_funding_balances set submitted_atoms=submitted_atoms-b.amount_atoms,
    paid_atoms=paid_atoms+b.amount_atoms,updated_at=now()
    where launch_id=b.launch_id and submitted_atoms>=b.amount_atoms;
  if not found then raise exception 'submitted launch funding is insufficient'; end if;
  update public.payout_batches set status='confirmed',confirmed_at=now(),updated_at=now(),error_message=null where id=b.id;
  update public.reward_distributions set status='confirmed',confirmed_at=now(),error_message=null where payout_batch_id=b.id;
  update public.wallet_positions p set previous_rewards_quote_atoms=p.previous_rewards_quote_atoms+d.amount_atoms
    from public.reward_distributions d where d.payout_batch_id=b.id and d.launch_id=p.launch_id and d.wallet=p.wallet;
  update public.reward_epochs set
    distributed_atoms=(select coalesce(sum(amount_atoms),0) from public.payout_batches where epoch_id=b.epoch_id and status='confirmed'),
    status=case when exists(select 1 from public.payout_batches where epoch_id=b.epoch_id and status<>'confirmed') then 'running'::public.epoch_status else 'completed'::public.epoch_status end,
    completed_at=case when exists(select 1 from public.payout_batches where epoch_id=b.epoch_id and status<>'confirmed') then null else now() end
    where id=b.epoch_id;
  insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,epoch_id,payout_batch_id,idempotency_key)
    values(b.launch_id,b.asset_mint,'pay',b.amount_atoms,b.epoch_id,b.id,'payout-paid:'||b.id::text);
  insert into public.transaction_proofs(launch_id,epoch_id,kind,signature,slot,payload,idempotency_key)
    values(b.launch_id,b.epoch_id,'distribution',b.signature,p_slot,p_proof,'payout-proof:'||b.id::text);
  return true;
end $$;

revoke all on function public.rebuild_wallet_position(uuid,text) from public;
revoke all on function public.claim_worker_lease(text,text,text,integer) from public;
revoke all on function public.bind_launch_payment(uuid,text,text) from public;
revoke all on function public.confirm_funding_deposit(uuid,text,bigint,timestamptz,jsonb) from public;
revoke all on function public.reserve_epoch_budget(uuid,bigint,bigint,timestamptz,timestamptz,numeric) from public;
revoke all on function public.release_empty_epoch(uuid) from public;
revoke all on function public.submit_payout_batch(uuid,text,text) from public;
revoke all on function public.expire_payout_batch(uuid) from public;
revoke all on function public.confirm_payout_batch(uuid,bigint,jsonb) from public;
grant execute on function public.rebuild_wallet_position(uuid,text) to service_role;
grant execute on function public.claim_worker_lease(text,text,text,integer) to service_role;
grant execute on function public.bind_launch_payment(uuid,text,text) to service_role;
grant execute on function public.confirm_funding_deposit(uuid,text,bigint,timestamptz,jsonb) to service_role;
grant execute on function public.reserve_epoch_budget(uuid,bigint,bigint,timestamptz,timestamptz,numeric) to service_role;
grant execute on function public.release_empty_epoch(uuid) to service_role;
grant execute on function public.submit_payout_batch(uuid,text,text) to service_role;
grant execute on function public.expire_payout_batch(uuid) to service_role;
grant execute on function public.confirm_payout_batch(uuid,bigint,jsonb) to service_role;

alter table public.chain_event_inbox enable row level security;
alter table public.launch_submission_receipts enable row level security;
alter table public.price_observations enable row level security;
alter table public.funding_intents enable row level security;
alter table public.funding_deposits enable row level security;
alter table public.launch_funding_balances enable row level security;
alter table public.funding_ledger enable row level security;
alter table public.payout_batches enable row level security;
alter table public.worker_leases enable row level security;

create policy public_confirmed_funding on public.funding_deposits for select using (true);
create policy public_funding_balances on public.launch_funding_balances for select using (true);
create policy public_price_observations on public.price_observations for select using (true);
create policy public_payout_batches on public.payout_batches for select using (status='confirmed');

create or replace view public.launch_funding_public with (security_invoker=true) as
select b.launch_id,b.asset_mint,b.available_atoms,b.reserved_atoms,b.submitted_atoms,b.paid_atoms,b.updated_at,
  coalesce((select sum(d.amount_atoms) from public.funding_deposits d where d.launch_id=b.launch_id),0) as total_funded_atoms
from public.launch_funding_balances b;

create or replace view public.launch_explore with (security_invoker=true) as
select l.id,l.mint,l.name,l.symbol,l.quote_symbol,l.creator_wallet,l.market_cap_usd,
  l.volume_24h_usd,l.liquidity_usd,l.price_usd,l.created_at,l.status,
  coalesce((select sum(d.amount_atoms) from public.reward_distributions d where d.launch_id=l.id and d.status='confirmed'),0) as total_rewarded_atoms,
  coalesce((select count(*) from public.reward_snapshots s where s.launch_id=l.id and s.status='ELIGIBLE' and s.epoch_id=(select e.id from public.reward_epochs e where e.launch_id=l.id and e.status='completed' order by e.sequence desc limit 1)),0) as eligible_wallets,
  l.image_url,l.tracker_status,
  coalesce((select sum(fd.amount_atoms) from public.funding_deposits fd where fd.launch_id=l.id),0) as total_funded_atoms
from public.launches l where l.status in ('active','paused') and l.mint is not null;
