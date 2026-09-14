import { spawn } from "node:child_process";

const mode = process.env.SERVICE_MODE ?? "web";
if (!new Set(["web", "worker"]).has(mode)) {
  throw new Error("SERVICE_MODE must be web or worker");
}

const child = spawn("pnpm", [mode === "worker" ? "worker:rewards" : "start"], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

