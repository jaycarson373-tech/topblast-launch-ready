-- Durable per-mint Pump.fun fee sharing and launch-isolated accounting.

alter table public.fee_events drop constraint if exists fee_events_source_check;
alter table public.fee_events add constraint fee_events_source_check
  check (source in ('stonkfun_forward','pumpfun_shared','creator_deposit','legacy_claim'));

create unique index if not exists fee_events_pump_shared_signature
  on public.fee_events(signature,asset_mint)
  where source='pumpfun_shared' and signature is not null;

create table if not exists public.pump_fee_operations (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  kind text not null check (kind in ('setup','distribute')),
  status text not null default 'planned' check (status in ('planned','prepared','signed','submitted','uncertain','confirmed','failed')),
  idempotency_key text not null unique,
  unsigned_transaction text,
  unsigned_message_hash text,
  signed_transaction text,
  signature text unique,
  last_valid_block_height bigint,
  amount_atoms numeric(39,0) check (amount_atoms is null or amount_atoms>0),
  slot bigint,
  proof jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,launch_id)
);

alter table public.pump_fee_operations enable row level security;
create policy public_confirmed_pump_fee_operations on public.pump_fee_operations
  for select using (status='confirmed' and exists (
    select 1 from public.launches l where l.id=pump_fee_operations.launch_id
      and (not l.is_test or l.public_test_listing) and not l.listing_hidden
  ));
revoke all on public.pump_fee_operations from anon,authenticated;
grant select on public.pump_fee_operations to anon,authenticated;

create or replace function public.credit_pump_shared_fee(
  p_operation_id uuid, p_launch_id uuid, p_signature text, p_amount_atoms numeric,
  p_slot bigint, p_block_time timestamptz, p_proof jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  l public.launches%rowtype;
  m public.tracked_markets%rowtype;
  c public.launch_configs%rowtype;
  operation public.pump_fee_operations%rowtype;
  event_id uuid;
  allocation_id uuid;
  reward_amount numeric;
  creator_amount numeric;
  protocol_amount numeric;
  prior_launch uuid;
begin
  if p_amount_atoms<=0 then raise exception 'fee amount must be positive'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_signature,0));
  select * into operation from public.pump_fee_operations where id=p_operation_id and launch_id=p_launch_id for update;
  if not found or operation.kind<>'distribute' or operation.status<>'confirmed'
    or operation.signature<>p_signature or operation.amount_atoms<>p_amount_atoms or operation.slot<>p_slot then
    raise exception 'confirmed Pump fee operation does not match';
  end if;
  select launch_id into prior_launch from public.fee_events
    where signature=p_signature and source='pumpfun_shared'
      and asset_mint=(select quote_mint from public.launches where id=p_launch_id)
    limit 1;
  if prior_launch is not null then
    if prior_launch<>p_launch_id then raise exception 'fee receipt already belongs to another launch'; end if;
    return false;
  end if;
  select * into l from public.launches where id=p_launch_id for update;
  if not found or l.venue<>'pumpfun' or l.status not in ('active','paused') then raise exception 'launch cannot receive Pump fees'; end if;
  select * into m from public.tracked_markets where launch_id=p_launch_id and active=true for update;
  if not found or m.quote_mint<>l.quote_mint or p_slot<m.launch_slot or p_slot>m.last_indexed_slot then
    raise exception 'fee receipt is outside indexed launch history';
  end if;
  select * into c from public.launch_configs where launch_id=p_launch_id and immutable=true;
  if not found or c.topblast_percent+c.creator_percent+c.protocol_percent<>100 then raise exception 'invalid immutable launch allocation'; end if;
  reward_amount=floor(p_amount_atoms*c.topblast_percent/100);
  creator_amount=floor(p_amount_atoms*c.creator_percent/100);
  protocol_amount=p_amount_atoms-reward_amount-creator_amount;
  insert into public.fee_events(launch_id,asset_mint,amount_atoms,source,signature,status)
    values(p_launch_id,l.quote_mint,p_amount_atoms,'pumpfun_shared',p_signature,'confirmed') returning id into event_id;
  insert into public.fee_allocations(launch_id,fee_event_id,topblast_atoms,creator_atoms,protocol_atoms)
    values(p_launch_id,event_id,reward_amount,creator_amount,protocol_amount) returning id into allocation_id;
  if reward_amount>0 then
    insert into public.launch_funding_balances(launch_id,asset_mint,available_atoms)
      values(p_launch_id,l.quote_mint,reward_amount)
      on conflict(launch_id) do update set available_atoms=public.launch_funding_balances.available_atoms+excluded.available_atoms,updated_at=now();
    insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,idempotency_key)
      values(p_launch_id,l.quote_mint,'credit',reward_amount,'pump-shared:'||p_signature);
  end if;
  if creator_amount>0 then
    insert into public.creator_fee_distributions(launch_id,fee_event_id,asset_mint,wallet,amount_atoms)
      values(p_launch_id,event_id,l.quote_mint,l.creator_wallet,creator_amount);
  end if;
  insert into public.protocol_revenue(launch_id,fee_allocation_id,asset_mint,amount_atoms,signature)
    values(p_launch_id,allocation_id,l.quote_mint,protocol_amount,p_signature);
  insert into public.transaction_proofs(launch_id,kind,signature,slot,payload,idempotency_key)
    values(p_launch_id,'fee_claim',p_signature,p_slot,p_proof,'pump-shared:'||p_signature);
  return true;
end $$;

revoke all on function public.credit_pump_shared_fee(uuid,uuid,text,numeric,bigint,timestamptz,jsonb) from public;
grant execute on function public.credit_pump_shared_fee(uuid,uuid,text,numeric,bigint,timestamptz,jsonb) to service_role;

create or replace view public.launch_funding_public with (security_invoker=true) as
select b.*,
  coalesce((select sum(d.amount_atoms) from public.funding_deposits d where d.launch_id=b.launch_id),0)
  + coalesce((select sum(a.topblast_atoms) from public.fee_allocations a join public.fee_events e on e.id=a.fee_event_id and e.launch_id=a.launch_id where a.launch_id=b.launch_id and e.source in ('stonkfun_forward','pumpfun_shared') and e.status='confirmed'),0) as total_funded_atoms
from public.launch_funding_balances b join public.launches l on l.id=b.launch_id
where not l.is_test or l.public_test_listing;
