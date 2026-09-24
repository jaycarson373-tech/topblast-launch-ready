import type { SupabaseClient } from "@supabase/supabase-js";
import { isAddress } from "@solana/addresses";

export interface LaunchWalletBinding {
  launchId: string;
  mint: string;
  venue: string;
  creator: string;
  treasury: string;
  rewardMint: string;
  immutable: boolean;
}

/** Public configuration only. This module must never load a signing secret. */
export function resolveLaunchWallet(binding: LaunchWalletBinding, env: NodeJS.ProcessEnv = process.env) {
  if (!binding.immutable || !isAddress(binding.mint) || !isAddress(binding.rewardMint) || !isAddress(binding.treasury)) {
    throw new Error("A verified mint and immutable payout configuration are required");
  }
  const dedicated = binding.treasury === env.TOPBLAST_CREATOR_ADDRESS && binding.treasury !== env.TOPBLAST_TREASURY_ADDRESS;
  if (dedicated) {
    if (binding.venue !== "stonkfun" || binding.mint !== env.TOPBLAST_TOKEN_MINT || binding.creator !== binding.treasury) {
      throw new Error("TOPBLAST creator wallet is restricted to its verified Stonk mint and creator");
    }
    return { address: binding.treasury, role: "topblast_creator" as const };
  }
  if (binding.treasury !== env.TOPBLAST_TREASURY_ADDRESS) {
    throw new Error("No authorized payout signer for this launch's immutable funding address");
  }
  // A new environment variable must never move existing balances or rewrite a
  // launch's immutable treasury. Existing platform launches keep their source.
  return { address: binding.treasury, role: "platform_treasury" as const };
}

export async function getLaunchWallet(db: SupabaseClient, launchId: string, env: NodeJS.ProcessEnv = process.env) {
  const [launch, config] = await Promise.all([
    db.from("launches").select("id,mint,venue,creator_wallet,status").eq("id", launchId).single(),
    db.from("launch_configs").select("launch_id,treasury_address,reward_asset_mint,immutable").eq("launch_id", launchId).single(),
  ]);
  if (launch.error) throw launch.error;
  if (config.error) throw config.error;
  if (launch.data.id !== launchId || config.data.launch_id !== launchId) throw new Error("Cross-launch payout configuration mismatch");
  const binding: LaunchWalletBinding = {
    launchId, mint: launch.data.mint, venue: launch.data.venue, creator: launch.data.creator_wallet,
    treasury: config.data.treasury_address, rewardMint: config.data.reward_asset_mint, immutable: config.data.immutable === true,
  };
  const wallet = resolveLaunchWallet(binding, env);
  if (wallet.role === "topblast_creator") {
    const market = await db.from("tracked_markets").select("launch_id,base_mint,quote_mint,creator_address,active").eq("launch_id", launchId).single();
    if (market.error) throw market.error;
    if (market.data.launch_id !== launchId || market.data.base_mint !== binding.mint || market.data.quote_mint !== binding.rewardMint || market.data.creator_address !== binding.creator || market.data.active !== true) {
      throw new Error("TOPBLAST creator payout requires its verified active market and fee recipient");
    }
  }
  return { ...wallet, binding, status: launch.data.status };
}
