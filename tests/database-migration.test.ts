import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("Supabase migrations", () => {
  it("applies cleanly and enforces launch-scoped funding keys", async () => {
    const db = new PGlite();
    // Supabase's service_role bypasses RLS but still obeys SQL table privileges.
    await db.exec("create role service_role bypassrls; create role anon; create role authenticated;");
    for (const file of ["202609130001_topblast_multilaunch.sql", "202609140001_audit_hardening.sql", "202609140002_operational_pipeline.sql", "202609150001_pumpfun.sql", "202609210001_test_launches.sql"]) {
      const sql = (await readFile(join(process.cwd(), "supabase", "migrations", file), "utf8")).replace("create extension if not exists pgcrypto;", "");
      await db.exec(sql);
    }
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609150001_pumpfun.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609210001_test_launches.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609220001_public_listing_controls.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609220001_public_listing_controls.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609220003_automatic_creator_fees.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609230001_epoch_release_policy.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609240001_pump_fee_sharing.sql"), "utf8"));
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609240002_stonk_isolated_receivers.sql"), "utf8"));
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
    const ra = "00000000-0000-4000-8000-0000000000aa", rb = "00000000-0000-4000-8000-0000000000bb";
    await db.query("insert into public.stonk_fee_receivers(id,address,treasury_address) values($1,'receiver-a','treasury'),($2,'receiver-b','treasury')", [ra, rb]);
    const reserved = await db.query<{ address: string }>("select address from public.reserve_stonk_fee_receiver($1,'treasury')", ["1".repeat(32)]);
    expect(reserved.rows[0].address).toBe("receiver-a");
    expect((await db.query("select address from public.reserve_stonk_fee_receiver($1,'treasury')", ["1".repeat(32)])).rows).toEqual(reserved.rows);
    expect((await db.query<{ address: string }>("select address from public.reserve_stonk_fee_receiver($1,'treasury')", ["2".repeat(32)])).rows[0].address).toBe("receiver-b");
    await expect(db.query("update public.stonk_fee_receivers set mint=$1 where id=$2", ["3".repeat(32), ra])).rejects.toThrow("immutable");
    for (const [id, mint, market] of [[a, "mint-a", "market-a"], [b, "mint-b", "market-b"]]) {
      await db.query("insert into public.launches(id,venue,creator_wallet,name,symbol,image_url,quote_mint,quote_symbol,mint,market_address,signed_quote_hash,status,is_test) values($1::uuid,case when $1::uuid::text like '%00b' then 'pumpfun' else 'stonkfun' end,'creator','Token','TOK','logo','stonk','STONK',$2,$3,'hash','active',$4)", [id, mint, market, id === b]);
      await db.query("insert into public.launch_configs(launch_id,fee_tier,topblast_percent,creator_percent,protocol_percent,reward_asset_mint,treasury_address) values($1,'1%',70,20,10,'stonk','treasury')", [id]);
      await db.query("insert into public.funding_intents(id,launch_id,funder_wallet,asset_mint,gross_amount_atoms,reward_amount_atoms,creator_amount_atoms,protocol_amount_atoms,reward_treasury,protocol_treasury,memo,unsigned_transaction,unsigned_message_hash,last_valid_block_height,status,signature,expires_at) values(gen_random_uuid(),$1,'creator','stonk',100,70,20,10,'treasury','protocol',$2,'wire','hash',99,'submitted',$3,now()+interval '1 minute')", [id, `memo-${id}`, `signature-${id}`]);
    }
    await db.query("insert into public.fee_events(launch_id,asset_mint,amount_atoms,source,signature,status) values($1,'stonk',100,'stonkfun_forward','one-forward','confirmed')", [a]);
    await expect(db.query("insert into public.fee_events(launch_id,asset_mint,amount_atoms,source,signature,status) values($1,'stonk',100,'stonkfun_forward','one-forward','confirmed')", [b])).rejects.toThrow();
    const intentA = await db.query<{ id: string }>("select id from public.funding_intents where launch_id=$1", [a]);
    await expect(db.query("update public.funding_intents set reward_treasury=funder_wallet where launch_id=$1", [a])).rejects.toThrow("funding_intents_no_self_funding");
    const intentB = await db.query<{ id: string }>("select id from public.funding_intents where launch_id=$1", [b]);
    const creditedA = await db.query<{ confirm_funding_deposit: boolean }>("select public.confirm_funding_deposit($1,$2,10,now(),'{}'::jsonb)", [intentA.rows[0].id, `signature-${a}`]);
    expect(creditedA.rows[0].confirm_funding_deposit).toBe(true);
    const duplicateA = await db.query<{ confirm_funding_deposit: boolean }>("select public.confirm_funding_deposit($1,$2,10,now(),'{}'::jsonb)", [intentA.rows[0].id, `signature-${a}`]);
    expect(duplicateA.rows[0].confirm_funding_deposit).toBe(false);
    await db.query("select public.confirm_funding_deposit($1,$2,11,now(),'{}'::jsonb)", [intentB.rows[0].id, `signature-${b}`]);
    await db.query("select public.reserve_epoch_budget($1,1,20,now()-interval '1 hour',now(),1)", [a]);
    const policies = await db.query<{ launch_id: string; epoch_release_bps: number }>("select launch_id,epoch_release_bps from public.launch_configs order by launch_id");
    expect(policies.rows).toEqual([{ launch_id: a, epoch_release_bps: 6500 }, { launch_id: b, epoch_release_bps: 6500 }]);
    const balances = await db.query<{ launch_id: string; available_atoms: string; reserved_atoms: string }>("select launch_id,available_atoms,reserved_atoms from public.launch_funding_balances order by launch_id");
    expect(balances.rows).toEqual([
      { launch_id: a, available_atoms: "25", reserved_atoms: "45" },
      { launch_id: b, available_atoms: "70", reserved_atoms: "0" },
    ]);
    const firstLease = await db.query<{ claim_worker_lease: boolean }>("select public.claim_worker_lease('market',$1,'one',60)", [a]);
    const competingLease = await db.query<{ claim_worker_lease: boolean }>("select public.claim_worker_lease('market',$1,'two',60)", [a]);
    expect(firstLease.rows[0].claim_worker_lease).toBe(true);
    expect(competingLease.rows[0].claim_worker_lease).toBe(false);
    const epoch = await db.query<{ id: string }>("select id from public.reward_epochs where launch_id=$1", [a]);
    const epochId = epoch.rows[0].id;
    const batches: string[] = [];
    for (const [sequence, amount, wallet] of [[0, 20, "holder-one"], [1, 25, "holder-two"]] as const) {
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
    expect(partial.rows[0]).toEqual({ status: "running", distributed_atoms: "20" });
    await db.query("select public.submit_payout_batch($1,'payout-two','signed-two')", [batches[1]]);
    await db.query("select public.confirm_payout_batch($1,31,'{}')", [batches[1]]);
    const completed = await db.query<{ status: string; distributed_atoms: string }>("select status,distributed_atoms from public.reward_epochs where id=$1", [epochId]);
    expect(completed.rows[0]).toEqual({ status: "completed", distributed_atoms: "45" });
    const aPaid = await db.query<{ paid_atoms: string }>("select paid_atoms from public.launch_funding_balances where launch_id=$1", [a]);
    const bPaid = await db.query<{ paid_atoms: string }>("select paid_atoms from public.launch_funding_balances where launch_id=$1", [b]);
    expect(aPaid.rows[0].paid_atoms).toBe("45");
    expect(bPaid.rows[0].paid_atoms).toBe("0");
    await db.query("insert into public.tracked_markets(launch_id,venue,market_address,base_mint,quote_mint,launch_slot,last_indexed_slot,active) values($1,'pumpfun','pump-market','pump-mint','stonk',1,100,true)", [b]);
    const pumpOperation = await db.query<{ id: string }>("insert into public.pump_fee_operations(launch_id,kind,status,idempotency_key,signature,amount_atoms,slot,proof) values($1,'distribute','confirmed','pump-distribute-test','pump-fee-one',100,50,$2::jsonb) returning id", [b, JSON.stringify({ blockTime: new Date().toISOString() })]);
    const pumpCredited = await db.query<{ credit_pump_shared_fee: boolean }>("select public.credit_pump_shared_fee($1,$2,'pump-fee-one',100,50,now(),'{}'::jsonb)", [pumpOperation.rows[0].id, b]);
    const pumpDuplicate = await db.query<{ credit_pump_shared_fee: boolean }>("select public.credit_pump_shared_fee($1,$2,'pump-fee-one',100,50,now(),'{}'::jsonb)", [pumpOperation.rows[0].id, b]);
    expect(pumpCredited.rows[0].credit_pump_shared_fee).toBe(true);
    expect(pumpDuplicate.rows[0].credit_pump_shared_fee).toBe(false);
    await expect(db.query("select public.credit_pump_shared_fee($1,$2,'pump-fee-one',100,50,now(),'{}'::jsonb)", [pumpOperation.rows[0].id, a])).rejects.toThrow("does not match");
    expect((await db.query<{ available_atoms: string }>("select available_atoms from public.launch_funding_balances where launch_id=$1", [b])).rows[0].available_atoms).toBe("140");
    const receiverA = "00000000-0000-4000-8000-0000000000cc";
    await db.query("insert into public.stonk_fee_receivers(id,address,treasury_address,mint) values($1,'isolated-a','treasury','mint-a')", [receiverA]);
    await db.query("insert into public.tracked_markets(launch_id,venue,market_address,base_mint,quote_mint,creator_address,launch_slot,last_indexed_slot,active) values($1,'stonkfun','market-a','mint-a','stonk','isolated-a',1,100,true)", [a]);
    const sweepA = await db.query<{ id: string }>("insert into public.stonk_receiver_operations(launch_id,receiver_id,kind,status,idempotency_key,asset_mint,amount_atoms,signature,slot,proof) values($1,$2,'sweep','confirmed','sweep-a','stonk',100,'isolated-fee-a',80,'{}') returning id", [a, receiverA]);
    expect((await db.query<{ credit_stonk_receiver_sweep: boolean }>("select public.credit_stonk_receiver_sweep($1)", [sweepA.rows[0].id])).rows[0].credit_stonk_receiver_sweep).toBe(true);
    expect((await db.query<{ credit_stonk_receiver_sweep: boolean }>("select public.credit_stonk_receiver_sweep($1)", [sweepA.rows[0].id])).rows[0].credit_stonk_receiver_sweep).toBe(false);
    expect((await db.query<{ available_atoms: string }>("select available_atoms from public.launch_funding_balances where launch_id=$1", [a])).rows[0].available_atoms).toBe("95");
    expect((await db.query<{ available_atoms: string }>("select available_atoms from public.launch_funding_balances where launch_id=$1", [b])).rows[0].available_atoms).toBe("140");
    const foreign = await db.query<{ id: string }>("insert into public.stonk_receiver_operations(launch_id,receiver_id,kind,status,idempotency_key,asset_mint,amount_atoms,signature,slot,proof) values($1,$2,'sweep','confirmed','foreign-sweep','stonk',100,'foreign-sig',80,'{}') returning id", [b, receiverA]);
    await expect(db.query("select public.credit_stonk_receiver_sweep($1)", [foreign.rows[0].id])).rejects.toThrow("identity mismatch");
    await expect(db.query("update public.stonk_receiver_operations set amount_atoms=101 where id=$1", [sweepA.rows[0].id])).rejects.toThrow("immutable");
    const gasA = await db.query<{ id: string }>("insert into public.stonk_receiver_operations(launch_id,receiver_id,kind,status,idempotency_key,asset_mint,amount_atoms,signature,slot,proof) values($1,$2,'gas','confirmed','gas-a','So11111111111111111111111111111111111111112',10000000,'gas-sig',80,'{}') returning id", [a, receiverA]);
    await expect(db.query("select public.credit_stonk_receiver_sweep($1)", [gasA.rows[0].id])).rejects.toThrow("confirmed sweep");
    await expect(db.query("insert into public.stonk_receiver_operations(launch_id,receiver_id,kind,idempotency_key,asset_mint,amount_atoms) values($1,$2,'gas','duplicate-gas','So11111111111111111111111111111111111111112',10000000)", [a, receiverA])).rejects.toThrow();
    // Public views hide tests even for a service-role caller that bypasses RLS.
    expect((await db.query<{ id: string }>("select id from public.launch_explore")).rows).toEqual([{ id: a }]);
    expect((await db.query<{ launch_id: string }>("select launch_id from public.launch_funding_public")).rows).toEqual([{ launch_id: a }]);
    await expect(db.query("update public.launches set is_test=false where id=$1", [b])).rejects.toThrow("classification is immutable");
    await db.query("insert into public.transaction_proofs(launch_id,kind,signature,idempotency_key) values($1,'snapshot','test-proof','test-proof')", [b]);
    // Match Supabase read grants while checking the policies themselves.
    await db.exec("grant usage on schema public to anon, authenticated; grant select on all tables in schema public to anon, authenticated;");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      expect((await db.query<{ id: string }>("select id from public.launches")).rows).toEqual([{ id: a }]);
      for (const table of ["launch_configs", "funding_deposits", "launch_funding_balances", "transaction_proofs"]) {
        expect((await db.query(`select launch_id from public.${table} where launch_id=$1`, [b])).rows).toEqual([]);
      }
      await db.exec("reset role");
    }
    await db.exec("set role anon");
    await expect(db.query("insert into public.funding_deposits(launch_id,intent_id,signature,sender_wallet,recipient_wallet,asset_mint,amount_atoms,gross_amount_atoms,protocol_amount_atoms,slot,block_time,proof) select launch_id,id,'evil','x','y','stonk',1,1,0,1,now(),'{}' from public.funding_intents limit 1")).rejects.toThrow();
    await db.exec("reset role");
    const c = "00000000-0000-4000-8000-00000000000c";
    await db.query("insert into public.launches(id,venue,creator_wallet,name,symbol,image_url,quote_mint,quote_symbol,mint,market_address,signed_quote_hash,status,is_test,public_test_listing) values($1,'stonkfun','creator','Public Test','TEST','logo','stonk','STONK','mint-c','market-c','hash','active',true,true)", [c]);
    await expect(db.query("update public.launches set public_test_listing=true where id=$1", [b])).rejects.toThrow("classification is immutable");
    await db.query("update public.launches set listing_hidden=true,listing_hidden_reason='Archived test, receipts preserved' where id=$1", [a]);
    await db.exec("set role anon");
    expect((await db.query<{ id: string }>("select id from public.launch_explore order by id")).rows).toEqual([{ id: c }]);
    expect((await db.query("select * from public.transaction_proofs where launch_id=$1", [a])).rows).toEqual([]);
    await db.exec("reset role");
    expect((await db.query("select id from public.launches where id=$1", [a])).rows).toHaveLength(1);
    await db.exec(await readFile(join(process.cwd(), "supabase/migrations/202609220002_prepare_rate_limits.sql"), "utf8"));
    for (let count = 1; count <= 31; count++) {
      expect((await db.query<{ consume_prepare_budget: boolean }>("select public.consume_prepare_budget('launch_prepare')")).rows[0].consume_prepare_budget).toBe(count <= 30);
    }
    expect((await db.query<{ consume_prepare_budget: boolean }>("select public.consume_prepare_budget('funding_prepare')")).rows[0].consume_prepare_budget).toBe(true);
    await db.exec("set role anon");
    await expect(db.query("select public.consume_prepare_budget('launch_prepare')")).rejects.toThrow();
    await db.exec("reset role");
    await db.query("update public.launches set listing_hidden=false where id=$1", [a]);
    await db.close();
  }, 60_000);
});
