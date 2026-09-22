begin;
-- Shared across Vercel instances and restarts. Recovery/submission is intentionally
-- not throttled here: callers must be able to reconcile already-signed receipts.
create or replace function public.consume_prepare_budget(p_scope text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_window bigint := floor(extract(epoch from clock_timestamp()) / 60);
        v_value jsonb;
begin
  if p_scope not in ('launch_prepare','funding_prepare') then raise exception 'Unknown prepare scope'; end if;
  insert into public.system_config(key,value,updated_at)
  values ('api_limit:' || p_scope, jsonb_build_object('window',v_window,'count',1),now())
  on conflict(key) do update set
    value=case when (system_config.value->>'window')::bigint=v_window
      then jsonb_build_object('window',v_window,'count',least((system_config.value->>'count')::int+1,31))
      else jsonb_build_object('window',v_window,'count',1) end,
    updated_at=now()
  returning value into v_value;
  return (v_value->>'count')::int <= 30;
end $$;
revoke all on function public.consume_prepare_budget(text) from public,anon,authenticated;
grant execute on function public.consume_prepare_budget(text) to service_role;
commit;
