"use strict";
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

async function persistGitState() {
  const git = async (...args) => (await execute("git", args, { timeout: 60_000 })).stdout.trim();
  try {
    const branch = process.env.GITHUB_REF_NAME;
    if (!branch) throw new Error("Missing GITHUB_REF_NAME");
    const dirty = await git("status", "--porcelain", "--", "data/state.json");
    if (dirty) {
      await git("add", "--", "data/state.json");
      await git("commit", "-m", "chore: update notification state", "--", "data/state.json");
    }
    // Retry a rejected push after incorporating user edits. Never force-push.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await git("push", "origin", `HEAD:refs/heads/${branch}`);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await git("pull", "--rebase", "origin", branch);
      }
    }
  } catch (cause) {
    const error = new Error("发送状态无法保存到GitHub，已暂停后续发送，防止重启后重复推送。请检查工作流的状态备份。", { cause });
    error.statePersistence = true;
    throw error;
  }
}

module.exports = { persistGitState };
