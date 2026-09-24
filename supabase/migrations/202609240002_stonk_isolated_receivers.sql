-- One worker-derived receiving wallet per mint. No private keys in Postgres.
create table public.stonk_fee_receivers (
  id uuid primary key,
  address text not null unique,
  treasury_address text not null,
  mint text unique,
  created_at timestamptz not null default now()
);
alter table public.stonk_fee_receivers enable row level security;
revoke all on public.stonk_fee_receivers from anon, authenticated;
grant select, insert, update on public.stonk_fee_receivers to service_role;

create function public.guard_stonk_receiver_binding() returns trigger language plpgsql as $$
begin
  if new.id<>old.id or new.address<>old.address or new.treasury_address<>old.treasury_address
    or (old.mint is not null and new.mint is distinct from old.mint) then
    raise exception 'Stonk receiver binding is immutable';
  end if;
  return new;
end $$;
create trigger stonk_receiver_immutable before update on public.stonk_fee_receivers
for each row execute function public.guard_stonk_receiver_binding();

create function public.reserve_stonk_fee_receiver(p_mint text,p_treasury text)
returns public.stonk_fee_receivers language plpgsql security definer set search_path=public as $$
declare r public.stonk_fee_receivers%rowtype;
begin
  if p_mint is null or length(p_mint) not between 32 and 44 then raise exception 'invalid mint'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stonk-receiver:'||p_mint,0));
  select * into r from public.stonk_fee_receivers where mint=p_mint;
  if found then
    if r.treasury_address<>p_treasury then raise exception 'receiver treasury mismatch'; end if;
    return r;
  end if;
  select * into r from public.stonk_fee_receivers where mint is null and treasury_address=p_treasury
    order by created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.stonk_fee_receivers set mint=p_mint where id=r.id returning * into r;
  return r;
end $$;
revoke all on function public.reserve_stonk_fee_receiver(text,text) from public;
grant execute on function public.reserve_stonk_fee_receiver(text,text) to service_role;

create table public.stonk_receiver_operations (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete restrict,
  receiver_id uuid not null references public.stonk_fee_receivers(id) on delete restrict,
  kind text not null check(kind in ('gas','sweep')),
  status text not null default 'planned' check(status in ('planned','prepared','signed','submitted','uncertain','confirmed','failed')),
  idempotency_key text not null unique,
  asset_mint text not null,
  amount_atoms numeric(39,0) not null check(amount_atoms>0),
  unsigned_transaction text,
  unsigned_message_hash text,
  signed_transaction text,
  signature text unique,
  last_valid_block_height bigint,
  slot bigint,
  proof jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,launch_id),
  check(kind<>'gas' or amount_atoms=10000000)
);
create unique index stonk_receiver_one_gas_topup on public.stonk_receiver_operations(receiver_id) where kind='gas';
create unique index stonk_receiver_one_inflight_sweep on public.stonk_receiver_operations(receiver_id)
 where kind='sweep' and status in ('planned','prepared','signed','submitted','uncertain');
alter table public.stonk_receiver_operations enable row level security;
revoke all on public.stonk_receiver_operations from anon,authenticated;
grant select, insert, update on public.stonk_receiver_operations to service_role;
create function public.guard_stonk_receiver_operation() returns trigger language plpgsql as $$
begin
  if new.launch_id<>old.launch_id or new.receiver_id<>old.receiver_id or new.kind<>old.kind
    or new.asset_mint<>old.asset_mint or new.amount_atoms<>old.amount_atoms or new.idempotency_key<>old.idempotency_key then
    raise exception 'Stonk operation intent is immutable';
  end if;
  if old.signature is not null and (new.signature is distinct from old.signature
    or new.signed_transaction is distinct from old.signed_transaction
    or new.unsigned_transaction is distinct from old.unsigned_transaction
    or new.unsigned_message_hash is distinct from old.unsigned_message_hash
    or new.last_valid_block_height is distinct from old.last_valid_block_height) then
    raise exception 'Signed Stonk receipt is immutable';
  end if;
  if old.status='confirmed' then raise exception 'Confirmed Stonk receipt is immutable'; end if;
  return new;
end $$;
create trigger stonk_operation_immutable before update on public.stonk_receiver_operations
for each row execute function public.guard_stonk_receiver_operation();

alter table public.fee_events drop constraint fee_events_source_check;
alter table public.fee_events add constraint fee_events_source_check
 check(source in ('stonkfun_forward','stonkfun_isolated','pumpfun_shared','creator_deposit','legacy_claim'));
create unique index fee_events_stonk_isolated_signature on public.fee_events(signature,asset_mint)
 where source='stonkfun_isolated';

-- Conservative native-SOL operating reserve. Existing WSOL holdings do not
-- reduce this reserve: over-reserving is safer than spending a holder's SOL.
create function public.stonk_gas_protected_sol() returns numeric
language plpgsql security definer set search_path=public as $$
declare native text='So11111111111111111111111111111111111111112'; total numeric;
begin
  if exists(select 1 from public.pump_fee_operations where kind='distribute' and status in ('signed','submitted','uncertain')) then
    raise exception 'Pump receipt reconciliation must finish before treasury gas funding';
  end if;
  select coalesce(sum(available_atoms+reserved_atoms+submitted_atoms),0) into total from public.launch_funding_balances where asset_mint=native;
  total=total+coalesce((select sum(amount_atoms) from public.creator_fee_distributions where asset_mint=native and status<>'confirmed'),0);
  total=total+coalesce((select sum(amount_atoms) from public.protocol_revenue where asset_mint=native),0);
  total=total+coalesce((select sum(o.amount_atoms) from public.pump_fee_operations o
    join public.launches l on l.id=o.launch_id where l.quote_mint=native and o.kind='distribute' and o.status='confirmed'
    and not exists(select 1 from public.fee_events e where e.signature=o.signature)),0);
  return total;
end $$;
revoke all on function public.stonk_gas_protected_sol() from public;
grant execute on function public.stonk_gas_protected_sol() to service_role;

create function public.credit_stonk_receiver_sweep(p_operation_id uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare o public.stonk_receiver_operations%rowtype; r public.stonk_fee_receivers%rowtype;
 l public.launches%rowtype; m public.tracked_markets%rowtype; c public.launch_configs%rowtype;
 event_id uuid; allocation_id uuid; rewards numeric; creator numeric; protocol numeric;
begin
  select * into o from public.stonk_receiver_operations where id=p_operation_id for update;
  if not found or o.kind<>'sweep' or o.status<>'confirmed' or o.signature is null or o.slot is null
    or o.proof is null or o.amount_atoms<=0 then raise exception 'confirmed sweep required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(o.signature,0));
  if exists(select 1 from public.fee_events where signature=o.signature and asset_mint=o.asset_mint) then
    if exists(select 1 from public.fee_events where signature=o.signature and asset_mint=o.asset_mint and launch_id<>o.launch_id) then raise exception 'receipt belongs to another launch'; end if;
    return false;
  end if;
  select * into r from public.stonk_fee_receivers where id=o.receiver_id;
  select * into l from public.launches where id=o.launch_id for update;
  if not found or l.venue<>'stonkfun' or l.status not in ('active','paused') or r.mint is distinct from l.mint
    or o.asset_mint<>l.quote_mint then raise exception 'receiver launch identity mismatch'; end if;
  select * into m from public.tracked_markets where launch_id=l.id and active for update;
  if not found or m.creator_address<>r.address or m.base_mint<>r.mint or m.quote_mint<>o.asset_mint
    or o.slot<m.launch_slot or o.slot>m.last_indexed_slot then raise exception 'sweep outside indexed receiver history'; end if;
  select * into c from public.launch_configs where launch_id=l.id and immutable;
  if not found or c.treasury_address<>r.treasury_address or c.topblast_percent+c.creator_percent+c.protocol_percent<>100 then raise exception 'invalid receiver allocation'; end if;
  rewards=floor(o.amount_atoms*c.topblast_percent/100);
  creator=floor(o.amount_atoms*c.creator_percent/100);
  protocol=o.amount_atoms-rewards-creator;
  insert into public.fee_events(launch_id,asset_mint,amount_atoms,source,signature,status)
   values(l.id,o.asset_mint,o.amount_atoms,'stonkfun_isolated',o.signature,'confirmed') returning id into event_id;
  insert into public.fee_allocations(launch_id,fee_event_id,topblast_atoms,creator_atoms,protocol_atoms)
   values(l.id,event_id,rewards,creator,protocol) returning id into allocation_id;
  if rewards>0 then
    insert into public.launch_funding_balances(launch_id,asset_mint,available_atoms) values(l.id,o.asset_mint,rewards)
    on conflict(launch_id) do update set available_atoms=public.launch_funding_balances.available_atoms+excluded.available_atoms,updated_at=now();
    insert into public.funding_ledger(launch_id,asset_mint,kind,amount_atoms,idempotency_key)
     values(l.id,o.asset_mint,'credit',rewards,'stonk-isolated:'||o.signature);
  end if;
  if creator>0 then
    insert into public.creator_fee_distributions(launch_id,fee_event_id,asset_mint,wallet,amount_atoms)
     values(l.id,event_id,o.asset_mint,l.creator_wallet,creator);
  end if;
  insert into public.protocol_revenue(launch_id,fee_allocation_id,asset_mint,amount_atoms,signature)
   values(l.id,allocation_id,o.asset_mint,protocol,o.signature);
  insert into public.transaction_proofs(launch_id,kind,signature,slot,payload,idempotency_key)
   values(l.id,'fee_forward',o.signature,o.slot,o.proof,'stonk-isolated:'||o.signature);
  return true;
end $$;
revoke all on function public.credit_stonk_receiver_sweep(uuid) from public;
grant execute on function public.credit_stonk_receiver_sweep(uuid) to service_role;

create or replace view public.launch_funding_public with(security_invoker=true) as
select b.*,
 coalesce((select sum(d.amount_atoms) from public.funding_deposits d where d.launch_id=b.launch_id),0)
 + coalesce((select sum(a.topblast_atoms) from public.fee_allocations a join public.fee_events e on e.id=a.fee_event_id and e.launch_id=a.launch_id
   where a.launch_id=b.launch_id and e.source in ('stonkfun_forward','stonkfun_isolated','pumpfun_shared') and e.status='confirmed'),0) as total_funded_atoms
from public.launch_funding_balances b join public.launches l on l.id=b.launch_id
where (not l.is_test or l.public_test_listing) and not l.listing_hidden;
