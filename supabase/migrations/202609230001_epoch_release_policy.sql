-- Preserve part of every funded reward balance for future epochs.
-- This policy is launch-scoped and enforced inside the same locked transaction
-- that creates the epoch, so concurrent workers cannot reserve the remainder.
alter table public.launch_configs
  add column if not exists epoch_release_bps integer not null default 6500;

alter table public.launch_configs
  drop constraint if exists launch_configs_epoch_release_bps_check;

alter table public.launch_configs
  add constraint launch_configs_epoch_release_bps_check
  check (epoch_release_bps between 1 and 10000);

create or replace function public.reserve_epoch_budget(
  p_launch_id uuid, p_start_slot bigint, p_snapshot_slot bigint,
  p_start_time timestamptz, p_end_time timestamptz, p_price numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  b public.launch_funding_balances%rowtype;
  cfg public.launch_configs%rowtype;
  epoch_id uuid;
  seq integer;
  amount numeric;
begin
  select * into b
    from public.launch_funding_balances
    where launch_id=p_launch_id
    for update;
  if not found or b.available_atoms<=0 then return null; end if;

  select * into cfg from public.launch_configs where launch_id=p_launch_id;
  if not found then raise exception 'launch configuration not found'; end if;

  amount:=trunc(b.available_atoms*cfg.epoch_release_bps/10000);
  if amount<=0 then return null; end if;

  select coalesce(max(sequence),0)+1 into seq
    from public.reward_epochs where launch_id=p_launch_id;
  insert into public.reward_epochs(
    launch_id,sequence,status,reward_asset_mint,start_slot,snapshot_slot,
    funded_budget_atoms,start_time,end_time,reference_price_quote_atoms,
    price_observation_slot,history_complete,started_at
  ) values(
    p_launch_id,seq,'running',cfg.reward_asset_mint,p_start_slot,p_snapshot_slot,
    amount,p_start_time,p_end_time,p_price,p_snapshot_slot,true,now()
  ) returning id into epoch_id;

  update public.launch_funding_balances
    set available_atoms=available_atoms-amount,
        reserved_atoms=reserved_atoms+amount,
        updated_at=now()
    where launch_id=p_launch_id;
  insert into public.funding_ledger(
    launch_id,asset_mint,kind,amount_atoms,epoch_id,idempotency_key
  ) values(
    p_launch_id,cfg.reward_asset_mint,'reserve',amount,epoch_id,
    'epoch-reserve:'||epoch_id::text
  );
  return epoch_id;
end $$;

revoke all on function public.reserve_epoch_budget(uuid,bigint,bigint,timestamptz,timestamptz,numeric) from public;
grant execute on function public.reserve_epoch_budget(uuid,bigint,bigint,timestamptz,timestamptz,numeric) to service_role;
