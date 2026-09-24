// Use the official SDK's CJS entry consistently in Next and the Node worker.
import { createRequire } from "node:module";
const sdk = createRequire(import.meta.url)("@raydium-io/raydium-sdk-v2") as typeof import("@raydium-io/raydium-sdk-v2");
export const { initializeV2, initializeWithToken2022, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId,
  getPdaLaunchpadConfigId, getPdaMetadataKey, getPdaPlatformCurveRule, getPdaPlatformAllowConfig,
  LaunchpadConfig, PlatformConfig, PlatformCurveRule, Curve, buyExactInInstruction, getPdaPlatformVault, getPdaCreatorVault } = sdk;
