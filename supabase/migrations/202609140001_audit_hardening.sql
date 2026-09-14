-- Apply after 202609130001_topblast_multilaunch.sql.
-- Operational tables are server-only. Supabase default grants must never allow
-- anonymous writes to fee accounting or the worker control plane.
alter table public.verified_buys enable row level security;
alter table public.wallet_activity enable row level security;
alter table public.fee_events enable row level security;
alter table public.fee_allocations enable row level security;
alter table public.protocol_revenue enable row level security;
alter table public.worker_steps enable row level security;
alter table public.system_config enable row level security;

-- Aggregate independently: joining all distributions to all snapshots multiplied
-- the amount paid by the number of historical snapshot rows.
create or replace view public.launch_explore with (security_invoker = true) as
select l.id, l.mint, l.name, l.symbol, l.quote_symbol, l.creator_wallet, l.market_cap_usd,
  l.volume_24h_usd, l.liquidity_usd, l.price_usd, l.created_at, l.status,
  coalesce((select sum(d.amount_atoms) from public.reward_distributions d
    where d.launch_id = l.id and d.status = 'confirmed'), 0) as total_rewarded_atoms,
  (select count(distinct s.wallet) from public.reward_snapshots s
    where s.launch_id = l.id and s.status = 'ELIGIBLE' and s.epoch_id =
      (select e.id from public.reward_epochs e where e.launch_id = l.id
       and e.status = 'completed' order by e.sequence desc limit 1)) as eligible_wallets
from public.launches l
where l.status in ('active', 'paused') and l.mint is not null;
