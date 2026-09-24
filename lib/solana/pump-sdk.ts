// The official SDK's ESM dependency imports Anchor's CJS BN as a named export.
// Select the supported CJS entry consistently in the worker, tests and Next server.
import { createRequire } from "node:module";
const sdk = createRequire(import.meta.url)("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
export const { PUMP_SDK, OnlinePumpSdk, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_EVENT_AUTHORITY_PDA, GLOBAL_PDA, bondingCurvePda, creatorVaultPda, feeSharingConfigPda, pumpIdl } = sdk;
export type { DistributeCreatorFeesEvent, SharingConfig, TradeEventBc } from "@pump-fun/pump-sdk";
