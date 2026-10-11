"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

test("每次发送后的状态确实推送到远端仓库，推送失败被标记为致命错误", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "faze-state-"));
  const bare = path.join(dir, "remote.git");
  const work = path.join(dir, "work");
  const git = async (...args) => exec("git", args, { cwd: work });
  try {
    await exec("git", ["init", "--bare", bare]);
    await exec("git", ["clone", bare, work]);
    await git("checkout", "-b", "main");
    await git("config", "user.name", "test");
    await git("config", "user.email", "test@example.invalid");
    await fs.mkdir(path.join(work, "data"));
    await fs.writeFile(path.join(work, "data/state.json"), '{}\n');
    await git("add", ".");
    await git("commit", "-m", "initial");
    await git("push", "-u", "origin", "main");
    const value = '{"matches":{"123":{"resultSent":true}}}\n';
    await fs.writeFile(path.join(work, "data/state.json"), value);
    const modulePath = path.resolve(__dirname, "../src/git-state.js");
    const code = `require(${JSON.stringify(modulePath)}).persistGitState().catch(e => { console.error(e.statePersistence); process.exit(2); })`;
    const env = { ...process.env, GITHUB_REF_NAME: "main" };
    await exec(process.execPath, ["-e", code], { cwd: work, env });
    const saved = await exec("git", ["--git-dir", bare, "show", "main:data/state.json"]);
    assert.equal(saved.stdout, value);
    await git("remote", "set-url", "origin", path.join(dir, "missing.git"));
    await assert.rejects(exec(process.execPath, ["-e", code], { cwd: work, env }), (e) =>
      e.code === 2 && e.stderr.includes("true"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
