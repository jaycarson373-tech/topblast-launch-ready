const baseUrl = (process.env.VERIFY_URL || "https://topblast-stonkfun-launchpad.vercel.app").replace(/\/$/, "");
const smokeOnly = process.argv.includes("--smoke");
const checks = [
  ["homepage", "/", [200]],
  ["launch page", "/launch", [200]],
  ["explore page", "/explore", [200]],
  ["liveness", "/api/live", [200]],
  ["health", "/api/health", smokeOnly ? [200, 503] : [200]],
];

let failed = false;
for (const [name, path, accepted] of checks) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) });
  const okay = accepted.includes(response.status);
  process.stdout.write(`${okay ? "PASS" : "FAIL"} ${name}: HTTP ${response.status}\n`);
  if (path === "/api/health") {
    const body = await response.json();
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    if (!smokeOnly && (body.ready !== true || body.rewardsReady !== true)) {
      failed = true;
      process.stdout.write("FAIL production readiness: launches and rewards must both be ready\n");
    }
  }
  failed ||= !okay;
}
if (failed) process.exit(1);

if (smokeOnly) process.stdout.write("Smoke checks only; this does not certify launches or rewards.\n");
