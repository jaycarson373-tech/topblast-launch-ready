import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("Supabase migrations", () => {
  it("applies cleanly and enforces launch-scoped funding keys", async () => {
    const db = new PGlite();
    // Supabase's service_role bypasses RLS but still obeys SQL table privileges.
    await db.exec("create role service_role bypassrls; create role anon; create role authenticated;");
    for (const file of ["202609130001_topblast_multilaunch.sql", "202609140001_audit_hardening.sql", "202609140002_operational_pipeline.sql", "202609150001_pumpfun.sql"]) {
      const sql = (await readFile(join(process.cwd(), "supabase", "migrations", file), "utf8")).replace("create extension if not exists pgcrypto;", "");
      await db.exec(sql);
    }
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609150001_pumpfun.sql"), "utf8"));
    await db.exec("set role service_role");
    await db.query("insert into public.launch_metadata(id,metadata,image_data) values('00000000-0000-4000-8000-000000000099','{}','test-image')");
    await expect(db.query("update public.launch_metadata set image_data='overwritten'")).rejects.toThrow();
    await expect(db.query("delete from public.launch_metadata")).rejects.toThrow();
    await db.exec("reset role");
    const result = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name in ('funding_deposits','launch_funding_balances','payout_batches','worker_leases') order by table_name");
    expect(result.rows.map((row) => row.table_name)).toEqual(["funding_deposits", "launch_funding_balances", "payout_batches", "worker_leases"]);
    const columns = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='public' and table_name='funding_deposits'");
    expect(columns.rows.map((row) => row.column_name)).toContain("launch_id");
    const a = "00000000-0000-4000-8000-00000000000a", b = "00000000-0000-4000-8000-00000000000b";
    for (const [id, mint, market] of [[a, "mint-a", "market-a"], [b, "mint-b", "market-b"]]) {
      await db.query("insert into public.launches(id,venue,creator_wallet,name,symbol,image_url,quote_mint,quote_symbol,mint,market_address,signed_quote_hash,status) values($1::uuid,case when $1::uuid::text like '%00b' then 'pumpfun' else 'stonkfun' end,'creator','Token','TOK','logo','stonk','STONK',$2,$3,'hash','active')", [id, mint, market]);
      await db.query("insert into public.launch_configs(launch_id,fee_tier,topblast_percent,creator_percent,protocol_percent,reward_asset_mint,treasury_address) values($1,'1%',70,20,10,'stonk','treasury')", [id]);
      await db.query("insert into public.funding_intents(id,launch_id,funder_wallet,asset_mint,gross_amount_atoms,reward_amount_atoms,creator_amount_atoms,protocol_amount_atoms,reward_treasury,protocol_treasury,memo,unsigned_transaction,unsigned_message_hash,last_valid_block_height,status,signature,expires_at) values(gen_random_uuid(),$1,'creator','stonk',100,70,20,10,'treasury','protocol',$2,'wire','hash',99,'submitted',$3,now()+interval '1 minute')", [id, `memo-${id}`, `signature-${id}`]);
    }
    const intentA = await db.query<{ id: string }>("select id from public.funding_intents where launch_id=$1", [a]);
    await expect(db.query("update public.funding_intents set reward_treasury=funder_wallet where launch_id=$1", [a])).rejects.toThrow("funding_intents_no_self_funding");
    const intentB = await db.query<{ id: string }>("select id from public.funding_intents where launch_id=$1", [b]);
    const creditedA = await db.query<{ confirm_funding_deposit: boolean }>("select public.confirm_funding_deposit($1,$2,10,now(),'{}'::jsonb)", [intentA.rows[0].id, `signature-${a}`]);
    expect(creditedA.rows[0].confirm_funding_deposit).toBe(true);
    const duplicateA = await db.query<{ confirm_funding_deposit: boolean }>("select public.confirm_funding_deposit($1,$2,10,now(),'{}'::jsonb)", [intentA.rows[0].id, `signature-${a}`]);
    expect(duplicateA.rows[0].confirm_funding_deposit).toBe(false);
    await db.query("select public.confirm_funding_deposit($1,$2,11,now(),'{}'::jsonb)", [intentB.rows[0].id, `signature-${b}`]);
    await db.query("select public.reserve_epoch_budget($1,1,20,now()-interval '1 hour',now(),1)", [a]);
    const balances = await db.query<{ launch_id: string; available_atoms: string; reserved_atoms: string }>("select launch_id,available_atoms,reserved_atoms from public.launch_funding_balances order by launch_id");
    expect(balances.rows).toEqual([
      { launch_id: a, available_atoms: "0", reserved_atoms: "70" },
      { launch_id: b, available_atoms: "70", reserved_atoms: "0" },
    ]);
    const firstLease = await db.query<{ claim_worker_lease: boolean }>("select public.claim_worker_lease('market',$1,'one',60)", [a]);
    const competingLease = await db.query<{ claim_worker_lease: boolean }>("select public.claim_worker_lease('market',$1,'two',60)", [a]);
    expect(firstLease.rows[0].claim_worker_lease).toBe(true);
    expect(competingLease.rows[0].claim_worker_lease).toBe(false);
    const epoch = await db.query<{ id: string }>("select id from public.reward_epochs where launch_id=$1", [a]);
    const epochId = epoch.rows[0].id;
    const batches: string[] = [];
    for (const [sequence, amount, wallet] of [[0, 30, "holder-one"], [1, 40, "holder-two"]] as const) {
      const inserted = await db.query<{ id: string }>("insert into public.payout_batches(launch_id,epoch_id,sequence,asset_mint,amount_atoms,status,manifest,manifest_hash,unsigned_transaction,unsigned_message_hash) values($1,$2,$3,'stonk',$4,'prepared','[]','hash','wire','message') returning id", [a, epochId, sequence, amount]);
      const batchId = inserted.rows[0].id; batches.push(batchId);
      await db.query("insert into public.reward_distributions(launch_id,epoch_id,payout_batch_id,wallet,asset_mint,amount_atoms,status,idempotency_key) values($1,$2,$3,$4,'stonk',$5,'pending',$6)", [a, epochId, batchId, wallet, amount, `reward-${wallet}`]);
    }
    await db.query("select public.submit_payout_batch($1,'payout-one','signed-one')", [batches[0]]);
    const firstPaid = await db.query<{ confirm_payout_batch: boolean }>("select public.confirm_payout_batch($1,30,'{}')", [batches[0]]);
    const duplicatePaid = await db.query<{ confirm_payout_batch: boolean }>("select public.confirm_payout_batch($1,30,'{}')", [batches[0]]);
    expect(firstPaid.rows[0].confirm_payout_batch).toBe(true);
    expect(duplicatePaid.rows[0].confirm_payout_batch).toBe(false);
    const partial = await db.query<{ status: string; distributed_atoms: string }>("select status,distributed_atoms from public.reward_epochs where id=$1", [epochId]);
    expect(partial.rows[0]).toEqual({ status: "running", distributed_atoms: "30" });
    await db.query("select public.submit_payout_batch($1,'payout-two','signed-two')", [batches[1]]);
    await db.query("select public.confirm_payout_batch($1,31,'{}')", [batches[1]]);
    const completed = await db.query<{ status: string; distributed_atoms: string }>("select status,distributed_atoms from public.reward_epochs where id=$1", [epochId]);
    expect(completed.rows[0]).toEqual({ status: "completed", distributed_atoms: "70" });
    const aPaid = await db.query<{ paid_atoms: string }>("select paid_atoms from public.launch_funding_balances where launch_id=$1", [a]);
    const bPaid = await db.query<{ paid_atoms: string }>("select paid_atoms from public.launch_funding_balances where launch_id=$1", [b]);
    expect(aPaid.rows[0].paid_atoms).toBe("70");
    expect(bPaid.rows[0].paid_atoms).toBe("0");
    await db.exec("set role anon");
    await expect(db.query("insert into public.funding_deposits(launch_id,intent_id,signature,sender_wallet,recipient_wallet,asset_mint,amount_atoms,gross_amount_atoms,protocol_amount_atoms,slot,block_time,proof) select launch_id,id,'evil','x','y','stonk',1,1,0,1,now(),'{}' from public.funding_intents limit 1")).rejects.toThrow();
    await db.exec("reset role");
    await db.close();
  }, 30_000);
});
