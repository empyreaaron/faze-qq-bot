"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runCloudLoop } = require("../src/cloud-loop");

test("云端持续轮询保持五分钟间隔，结束后才接续下一任务", async () => {
  let now = 0;
  const starts = [];
  const result = await runCloudLoop({ clock: () => now, durationMs: 900_000,
    run: async () => { starts.push(now); now += 20_000; return 0; },
    wait: async (ms) => { now += ms; } });
  assert.deepEqual(starts, [0, 300_000, 600_000]);
  assert.equal(result.handoff, true);
});

test("单轮抓取失败会重试，状态保存失败则停止且不接续", async () => {
  let now = 0;
  const codes = [1, 0, 2];
  const result = await runCloudLoop({ clock: () => now, durationMs: 900_000,
    run: async () => codes.shift(), wait: async (ms) => { now += ms; },
    logger: { error() {} } });
  assert.equal(result.cycles, 3);
  assert.equal(result.lastCode, 2);
  assert.equal(result.handoff, false);
});

test("用户取消云端任务后不能自动重启", async () => {
  let stop = false;
  const result = await runCloudLoop({
    run: async () => { stop = true; return 0; }, stopped: () => stop,
    wait: async () => assert.fail("取消后不能继续等待和轮询"),
  });
  assert.equal(result.handoff, false);
  assert.equal(result.cycles, 1);
});

test("有一轮失败整个任务就标红，GitHub照常发失败邮件", async () => {
  let now = 0;
  const codes = [0, 1, 0];
  const result = await runCloudLoop({ clock: () => now, durationMs: 900_000,
    run: async () => { now += 1000; return codes.shift(); }, wait: async (ms) => { now += ms; },
    logger: { error() {} } });
  assert.equal(result.cycles, 3);
  assert.equal(result.lastCode, 1);
  assert.equal(result.handoff, true);
});

test("连续失败半小时提前结束，让失败邮件尽快发出并接续下一轮", async () => {
  let now = 0;
  const result = await runCloudLoop({ clock: () => now, durationMs: 5 * 60 * 60 * 1000,
    run: async () => { now += 1000; return 1; }, wait: async (ms) => { now += ms; },
    logger: { error() {} } });
  assert.equal(result.cycles, 6);
  assert.equal(result.lastCode, 1);
  assert.equal(result.handoff, true);
});
