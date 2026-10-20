"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { runMonitor } = require("./core");
const { HltvDataSource } = require("./hltv");
const { QQMessenger } = require("./qq");
const { persistGitState } = require("./git-state");

const statePath = path.resolve(__dirname, "..", "data", "state.json");
// Push at least this often even when nothing happened, so a fresh runner never
// starts from a very old snapshot.
const PUSH_HEARTBEAT_MS = 30 * 60 * 1000;

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

// Only the facts that decide whether a message still needs sending. Timestamps
// like lastRunAt change on every tick; committing those pushed ~288 commits a
// day, which is what made concurrent runs fight over data/state.json.
function sendFingerprint(state) {
  const matches = Object.values(state?.matches || {})
    .map(
      (match) =>
        `${match.id}:${match.status}:${match.startSent ? 1 : 0}:${match.resultSent ? 1 : 0}:${match.prematchSent ? 1 : 0}`,
    )
    .sort()
    .join("|");
  return matches;
}

async function saveState(state) {
  try {
    const fingerprint = sendFingerprint(state);
    const pushedAt = Date.parse(state.lastPushedAt || "");
    const push =
      fingerprint !== state.lastPushedFingerprint ||
      !Number.isFinite(pushedAt) ||
      Date.now() - pushedAt >= PUSH_HEARTBEAT_MS;
    if (push) {
      state.lastPushedFingerprint = fingerprint;
      state.lastPushedAt = new Date().toISOString();
    }
    const temporary = `${statePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporary, statePath);
    // A send is always followed by a fingerprint change, so the "already sent"
    // marker still reaches the remote before the next match is handled.
    if (push && process.env.GIT_SYNC_STATE === "true") await persistGitState();
  } catch (error) {
    error.statePersistence = true;
    throw error;
  }
}

async function executeMonitor({ state, dataSource, messenger, save = saveState,
  now = Date.now(), dryRun = false, logger = console, deadline = Infinity }) {
  const updated = await runMonitor({
    state, dataSource, messenger, now, logger, deadline,
    checkpoint: dryRun ? async () => {} : save,
  });
  if (!dryRun) await save(updated);
  if (updated.lastRunErrors.length) {
    throw new Error(`监控失败（${updated.lastRunErrors.length}个错误）；${dryRun ? "预览不写入状态" : "成功发送的记录已保存"}。\n${updated.lastRunErrors.join("\n")}`);
  }
  return updated;
}

async function main() {
  const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
  const now = process.env.NOW_ISO
    ? Date.parse(process.env.NOW_ISO)
    : Date.now();
  if (Number.isNaN(now)) throw new Error("NOW_ISO不是有效时间");

  const messenger = new QQMessenger({
    appId: process.env.QQ_APP_ID || (dryRun ? "preview" : ""),
    appSecret: process.env.QQ_APP_SECRET || (dryRun ? "preview" : ""),
    groupOpenId: process.env.QQ_GROUP_OPENID || (dryRun ? "preview" : ""),
    dryRun,
  });
  const state = await loadState();
  await executeMonitor({
    state,
    dataSource: new HltvDataSource(),
    messenger,
    now,
    dryRun,
    deadline: Date.now() + 180_000,
  });
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = error.statePersistence ? 2 : 1;
});

module.exports = { executeMonitor };

