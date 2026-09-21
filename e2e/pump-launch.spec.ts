import { test, expect } from "@playwright/test";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

// No chain connection: wallet signatures and every server response are fixtures.
// The browser still has to supply its mint partial-signature and persist recovery.
for (const { venue, testMode } of [{ venue: "pumpfun", testMode: false }, { venue: "pumpfun", testMode: true }, { venue: "stonkfun", testMode: true }]) {
for (const responseMode of ["timeout", "tracker_pending"] as const) {
  test(`${venue} ${testMode ? "hidden test" : "public"} launch recovery after ${responseMode}, one signing prompt`, async ({ page }) => {
    const creator = Keypair.generate().publicKey;
    let signedPrompts = 0, submissions = 0;
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.exposeFunction("recordSigningPrompt", () => { signedPrompts++; });
    await page.addInitScript(({ address, publicBytes }) => {
      const account = { address, publicKey: new Uint8Array(publicBytes), chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
      const wallet = { version: "1.0.0", name: "TopBlast fixture wallet", icon: "data:image/png;base64,iVBORw0KGgo=", chains: ["solana:mainnet"], accounts: [account], features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy"], signTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          await (window as unknown as { recordSigningPrompt(): Promise<void> }).recordSigningPrompt();
          const bytes = new Uint8Array(transaction);
          // A dummy payer signature for the mocked submission endpoint. Never broadcast.
          bytes.fill(1, 1, 65);
          return [{ signedTransaction: bytes }];
        } },
      } };
      const register = (api: { register(wallet: unknown): void }) => api.register(wallet);
      window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
    }, { address: creator.toBase58(), publicBytes: [...creator.toBytes()] });

    await page.route("**/api/**", (route) => route.abort());
    await page.route("**/api/health", (route) => route.fulfill({ json: { ready: false, missing: [], venues: { stonkfun: { launchReady: false }, pumpfun: { launchReady: true, blockers: [] } } } }));
    await page.route("**/api/launch/test-readiness", (route) => {
      expect(route.request().headers().authorization).toBe("Bearer fixture-operator-token");
      return route.fulfill({ json: { ready: true, pumpReady: true, missing: [], pumpBlockers: [] } });
    });
    const launchId = "00000000-0000-4000-8000-000000000001";
    await page.route("**/api/launch/prepare", async (route) => {
      const input = route.request().postDataJSON();
      expect(input.venue).toBe(venue); expect(input.creatorWallet).toBe(creator.toBase58());
      expect(input.isTest).toBe(testMode);
      if (testMode) expect(route.request().headers().authorization).toBe("Bearer fixture-operator-token");
      const mint = venue === "pumpfun" ? new PublicKey(input.pumpMint) : Keypair.generate().publicKey;
      // Two-signer fixture tests mint signing without constructing a real Pump launch.
      const transaction = new Transaction({ feePayer: creator, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(venue === "pumpfun"
        ? SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint, lamports: 1, space: 0, programId: SystemProgram.programId })
        : SystemProgram.transfer({ fromPubkey: creator, toPubkey: mint, lamports: 1 }));
      await route.fulfill({ json: { launchId, signedQuote: "fixture-only", paymentTransaction: transaction.serialize({ requireAllSignatures: false }).toString("base64"), payment: { sol: "0.01", lamports: "10000000", recipient: "fixture-program" }, expiresAt: new Date(Date.now() + 75_000).toISOString() } });
    });
    await page.route("**/api/launch/submit", async (route) => {
      submissions++;
      const input = route.request().postDataJSON();
      const transaction = Transaction.from(Buffer.from(input.signedTransaction, "base64"));
      expect(transaction.signatures).toHaveLength(venue === "pumpfun" ? 2 : 1);
      if (venue === "pumpfun") expect(transaction.signatures[1].signature?.some((value) => value !== 0)).toBe(true);
      if (testMode) expect(route.request().headers().authorization).toBe("Bearer fixture-operator-token");
      if (responseMode === "timeout") await route.abort();
      else await route.fulfill({ json: { status: "completed", mint: "fixture-mint", pool: "fixture-pool", signature: "fixture-signature", trackerStatus: "pending" } });
    });
    await page.route("**/api/launch/status/**", (route) => route.fulfill({ json: { status: "completed", mint: "fixture-mint", pool: "fixture-pool", signature: "fixture-signature", trackerStatus: "active" } }));

    await page.goto(testMode ? "/launch/test" : "/launch");
    if (testMode) {
      await expect(page.getByRole("button", { name: "Activation pending", exact: true })).toBeDisabled();
      await page.getByLabel("Operator access token").fill("fixture-operator-token");
      await page.getByRole("button", { name: "Check test access", exact: true }).click();
    }
    await page.getByLabel("Launch venue").selectOption(venue);
    await page.getByLabel("Token name").fill("Pump fixture");
    await page.getByLabel("Ticker").fill("TEST");
    await page.getByLabel("Image", { exact: true }).setInputFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=", "base64") });
    await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
    await expect(page.getByLabel("Token name")).toHaveValue("Pump fixture");
    await page.getByRole("button", { name: venue === "pumpfun" ? "Launch on Pump.fun" : "Launch on STONK", exact: true }).click();
    await expect(page.getByText("Transaction review", { exact: true })).toBeVisible();
    if (testMode) await expect(page.getByText("TEST LAUNCH · HIDDEN FROM PUBLIC TOPBLAST PAGES", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Token name")).toBeDisabled();
    await page.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Payment verification pending" })).toBeVisible();
    if (responseMode === "tracker_pending") await expect(page.getByText("Token launched. Tracker registration needs recovery.", { exact: true })).toBeVisible();
    await page.reload();
    if (testMode) await expect(page.getByLabel("Operator access token")).toHaveValue("");
    await page.getByRole("button", { name: "Check launch status", exact: true }).click();
    await expect(page.getByText("Launch complete. TopBlast tracking active.", { exact: true })).toBeVisible();
    expect(signedPrompts).toBe(1); expect(submissions).toBe(1); expect(browserErrors).toEqual([]);
  });
}
}
