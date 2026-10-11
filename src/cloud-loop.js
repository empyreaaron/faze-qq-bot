"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

// Keep one cloud runner alive for five hours, then explicitly start its successor.
// This avoids relying on GitHub schedule events for every five-minute tick.
async function runCloudLoop({ run, wait, clock = Date.now, durationMs = 5 * 60 * 60 * 1000,
  intervalMs = 300_000, stopped = () => false, logger = console }) {
  const end = clock() + durationMs;
  let lastCode = 1;
  let cycles = 0;
  while (!stopped() && clock() < end) {
    const started = clock();
    lastCode = await run();
    cycles += 1;
    if (lastCode === 2 || lastCode === null) {
      return { cycles, lastCode, handoff: false }; // State sync failure or cancellation.
    }
    if (lastCode !== 0) logger.error("本轮抓取失败，队列已保留，下一轮重试。");
    const remaining = end - clock();
    if (stopped() || remaining <= 0) break;
    await wait(Math.min(remaining, Math.max(1000, intervalMs - (clock() - started))));
  }
  return { cycles, lastCode, handoff: !stopped() && cycles > 0 };
}

async function main() {
  let stopping = false;
  let child;
  let wake;
  const stop = () => { stopping = true; child?.kill("SIGTERM"); wake?.(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const result = await runCloudLoop({
    run: () => new Promise((resolve) => {
      child = spawn(process.execPath, [path.join(__dirname, "index.js")], { stdio: "inherit" });
      child.once("error", () => resolve(2));
      child.once("close", (code) => { child = null; resolve(code); });
    }),
    wait: (ms) => new Promise((resolve) => {
      const timer = setTimeout(() => { wake = null; resolve(); }, ms);
      wake = () => { clearTimeout(timer); wake = null; resolve(); };
      if (stopping) wake();
    }),
    stopped: () => stopping,
  });
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `handoff=${result.handoff}\n`);
  }
  console.log(`已完成 ${result.cycles} 轮检查；自动接续：${result.handoff}。`);
  process.exitCode = result.lastCode || 0;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { runCloudLoop };
