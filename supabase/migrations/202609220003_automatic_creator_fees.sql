-- Credit finalized, pool-attributable Stonk LaunchLab creator-fee forwards.
-- The receipt signature is globally single-use across launches for an asset.
create unique index if not exists fee_events_stonk_forward_signature
  on public.fee_events(signature,asset_mint)
  where source='stonkfun_forward' and signature is not null;

create table if not exists public.creator_fee_distributions (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  fee_event_id uuid not null references public.fee_events(id) on delete restrict,
  asset_mint text not null,
  wallet text not null,
  amount_atoms numeric(39,0) not null check (amount_atoms > 0),
  status text not null default 'planned' check (status in ('planned','prepared','signed','submitted','uncertain','confirmed','failed')),
  unsigned_transaction text,
  unsigned_message_hash text,
  signed_transaction text,
  signature text unique,
  last_valid_block_height bigint,
  proof jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(launch_id,fee_event_id),
  foreign key(fee_event_id,launch_id) references public.fee_events(id,launch_id) on delete restrict
);

alter table public.creator_fee_distributions enable row level security;
create policy public_confirmed_creator_fee_distributions on public.creator_fee_distributions
  for select using (status='confirmed');
create policy public_confirmed_stonk_fee_events on public.fee_events
  for select using (status='confirmed' and exists (
    select 1 from public.launches l where l.id=fee_events.launch_id and (not l.is_test or l.public_test_listing) and not l.listing_hidden
  ));
create policy public_confirmed_stonk_fee_allocations on public.fee_allocations
  for select using (exists (
    select 1 from public.fee_events e join public.launches l on l.id=e.launch_id
    where e.id=fee_allocations.fee_event_id and e.launch_id=fee_allocations.launch_id and e.status='confirmed'
      and (not l.is_test or l.public_test_listing) and not l.listing_hidden
  ));

create or replace function public.credit_stonk_forwarded_fee(
  p_launch_id uuid, p_signature text, p_amount_atoms numeric,
  p_slot bigint, p_block_time timestamptz, p_proof jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  l public.launches%rowtype;
  m public.tracked_markets%rowtype;
  c public.launch_configs%rowtype;
  event_id uuid;
  allocation_id uuid;
  reward_amount numeric;
  creator_amount numeric;
  protocol_amount numeric;
  prior_launch uuid;
begin
  if p_amount_atoms<=0 then raise exception 'fee amount must be positive'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_signature,0));
  select launch_id into prior_launch from public.fee_events
    where signature=p_signature and source='stonkfun_forward' and asset_mint=(select quote_mint from public.launches where id=p_launch_id)
    limit 1;
  if prior_launch is not null then
    if prior_launch<>p_launch_id then raise exception 'fee receipt already belongs to another launch'; end if;
    return false;
  end if;
  select * into l from public.launches where id=p_launch_id for update;
  if not found or l.venue<>'stonkfun' or l.status not in ('active','paused') then raise exception 'launch cannot receive Stonk fees'; end if;
  select * into m from public.tracked_markets where launch_id=p_launch_id and active=true for update;
  if not found or m.quote_mint<>l.quote_mint or p_slot<m.launch_slot or p_slot>m.last_indexed_slot then raise exception 'fee receipt is outside indexed launch history'; end if;
  select * into c from public.launch_configs where launch_id=p_launch_id and immutable=true;
  if not found or c.topblast_percent+c.creator_percent+c.protocol_percent<>100 then raise exception 'invalid immutable launch allocation'; end if;
  reward_amount=floor(p_amount_atoms*c.topblast_percent/100);
  creator_amount=floor(p_amount_atoms*c.creator_percent/100);
  protocol_amount=p_amount_atoms-reward_amount-creator_amount;
  insert into public.fee_events(launch_id,asset_mint,amount_atoms,source,signature,status)
    values(p_launch_id,l.quote_mint,p_amount_atoms,'stonkfun_forward',p_signature,'confirmed') returning id into event_id;
  insert into public.fee_allocations(launch_id,fee_event_id,topblast_atoms,creator_atoms,protocol_atoms)
    values(p_launch_id,event_id,reward_amount,creator_amount,protocol_amount) returning id into allocation_id;
  if reward_amount>0 then
    insert into public.launch_funding_balances(launch_id,asset_mint,available_atoms)
      values(p_launch_id,l.quote_mint,reward_amount)
      on conflict(launch_id) do update set available_atoms=public.launch_funding_balances.available_atoms+excluded.available_atoms,updated_at=now();
    insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,idempotency_key)
      values(p_launch_id,l.quote_mint,'credit',reward_amount,'stonk-forward:'||p_signature);
  end if;
  if creator_amount>0 then
    insert into public.creator_fee_distributions(launch_id,fee_event_id,asset_mint,wallet,amount_atoms)
      values(p_launch_id,event_id,l.quote_mint,l.creator_wallet,creator_amount);
  end if;
  insert into public.protocol_revenue(launch_id,fee_allocation_id,asset_mint,amount_atoms,signature)
    values(p_launch_id,allocation_id,l.quote_mint,protocol_amount,p_signature);
  insert into public.transaction_proofs(launch_id,kind,signature,slot,payload,idempotency_key)
    values(p_launch_id,'fee_forward',p_signature,p_slot,p_proof,'stonk-forward:'||p_signature);
  return true;
end $$;

revoke all on function public.credit_stonk_forwarded_fee(uuid,text,numeric,bigint,timestamptz,jsonb) from public;
grant execute on function public.credit_stonk_forwarded_fee(uuid,text,numeric,bigint,timestamptz,jsonb) to service_role;
revoke all on public.creator_fee_distributions from anon,authenticated;
grant select on public.creator_fee_distributions to anon,authenticated;

create or replace view public.launch_funding_public with (security_invoker=true) as
select b.*,
  coalesce((select sum(d.amount_atoms) from public.funding_deposits d where d.launch_id=b.launch_id),0)
  + coalesce((select sum(a.topblast_atoms) from public.fee_allocations a join public.fee_events e on e.id=a.fee_event_id and e.launch_id=a.launch_id where a.launch_id=b.launch_id and e.source='stonkfun_forward' and e.status='confirmed'),0) as total_funded_atoms
from public.launch_funding_balances b join public.launches l on l.id=b.launch_id
where not l.is_test or l.public_test_listing;
