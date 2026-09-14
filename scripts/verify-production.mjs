const baseUrl = (process.env.VERIFY_URL || "https://topblast-stonkfun-launchpad.vercel.app").replace(/\/$/, "");
const checks = [
  ["homepage", "/", [200]],
  ["launch page", "/launch", [200]],
  ["explore page", "/explore", [200]],
  ["health", "/api/health", [200, 503]],
];

let failed = false;
for (const [name, path, accepted] of checks) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) });
  const okay = accepted.includes(response.status);
  process.stdout.write(`${okay ? "PASS" : "FAIL"} ${name}: HTTP ${response.status}\n`);
  if (path === "/api/health") {
    const body = await response.json();
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  }
  failed ||= !okay;
}
if (failed) process.exit(1);
