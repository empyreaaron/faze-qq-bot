"use strict";

// Run on an always-on computer/server when prompt polling is required.
require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const lock = path.join(root, "data", "watch.lock");
let child;
let stopping = false;
let wake;
const stop = () => {
  stopping = true;
  if (child) child.kill("SIGTERM");
  if (wake) wake();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
  // Exclusive lock: refuse a second watcher instead of risking duplicate sends.
  const handle = await fs.open(lock, "wx");
  await handle.writeFile(String(process.pid));
  try {
    while (!stopping) {
      const started = Date.now();
      await new Promise((resolve) => {
        child = spawn(process.execPath, [path.join(__dirname, "index.js")], {
          cwd: root, env: process.env, stdio: "inherit",
        });
        child.once("error", (error) => console.error(error.message));
        child.once("close", (code) => {
          child = null;
          if (code !== 0) console.error(`本轮监控未成功（${code}），保留队列，下轮重试。`);
          resolve();
        });
      });
      if (stopping) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.max(1000, 300_000 - (Date.now() - started)));
        wake = () => { clearTimeout(timer); resolve(); };
      });
      wake = null;
    }
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}

main().catch((error) => {
  console.error(error.code === "EEXIST" ?
    "已有watch进程或残留锁；确认旧进程已停止后删除data/watch.lock。" : error.message);
  process.exitCode = 1;
});
