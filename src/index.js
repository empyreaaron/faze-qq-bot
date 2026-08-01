"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { runMonitor } = require("./core");
const { HltvDataSource } = require("./hltv");
const { QQMessenger } = require("./qq");

const statePath = path.resolve(__dirname, "..", "data", "state.json");

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function saveState(state) {
  const temporary = `${statePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, statePath);
}

async function main() {
  const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
  const now = process.env.NOW_ISO
    ? Date.parse(process.env.NOW_ISO)
    : Date.now();
  if (Number.isNaN(now)) throw new Error("NOW_ISO不是有效时间");

  const messenger = new QQMessenger({
    appId: process.env.QQ_APP_ID,
    appSecret: process.env.QQ_APP_SECRET,
    groupOpenId: process.env.QQ_GROUP_OPENID,
    dryRun,
  });
  const state = await loadState();
  const updated = await runMonitor({
    state,
    dataSource: new HltvDataSource(),
    messenger,
    now,
  });
  await saveState(updated);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
