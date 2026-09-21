begin;
alter table public.launches add column if not exists is_test boolean not null default false;

-- Classification is fixed before any payment. Tests cannot silently become listings.
create or replace function public.preserve_launch_test_classification() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_test is distinct from old.is_test then
    raise exception 'Launch test classification is immutable';
  end if;
  return new;
end $$;
drop trigger if exists immutable_test_classification on public.launches;
create trigger immutable_test_classification before update on public.launches
for each row execute function public.preserve_launch_test_classification();

alter policy public_active_launches on public.launches using (not is_test and status in ('active','paused'));

-- Restrictive policies also cover direct Supabase reads, not just the website.
do $$ declare table_name text; begin
  foreach table_name in array array['launch_configs','reward_epochs','reward_snapshots',
    'reward_allocations','reward_distributions','transaction_proofs','funding_deposits',
    'launch_funding_balances','price_observations','payout_batches'] loop
    execute format('drop policy if exists exclude_test_launches on public.%I', table_name);
    execute format('create policy exclude_test_launches on public.%I as restrictive for select
      to anon, authenticated using (exists (select 1 from public.launches l where l.id = launch_id and not l.is_test))', table_name);
  end loop;
end $$;

create or replace view public.launch_explore with (security_invoker=true) as
select l.id,l.mint,l.name,l.symbol,l.quote_symbol,l.creator_wallet,l.market_cap_usd,
  l.volume_24h_usd,l.liquidity_usd,l.price_usd,l.created_at,l.status,
  coalesce((select sum(d.amount_atoms) from public.reward_distributions d where d.launch_id=l.id and d.status='confirmed'),0) as total_rewarded_atoms,
  coalesce((select count(*) from public.reward_snapshots s where s.launch_id=l.id and s.status='ELIGIBLE' and s.epoch_id=(select e.id from public.reward_epochs e where e.launch_id=l.id and e.status='completed' order by e.sequence desc limit 1)),0) as eligible_wallets,
  l.image_url,l.tracker_status,
  coalesce((select sum(fd.amount_atoms) from public.funding_deposits fd where fd.launch_id=l.id),0) as total_funded_atoms
from public.launches l where not l.is_test and l.status in ('active','paused') and l.mint is not null;

create or replace view public.launch_funding_public with (security_invoker=true) as
select b.launch_id,b.asset_mint,b.available_atoms,b.reserved_atoms,b.submitted_atoms,b.paid_atoms,b.updated_at,
  coalesce((select sum(d.amount_atoms) from public.funding_deposits d where d.launch_id=b.launch_id),0) as total_funded_atoms
from public.launch_funding_balances b join public.launches l on l.id=b.launch_id where not l.is_test;
commit;
