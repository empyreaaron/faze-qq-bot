"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runMonitor } = require("../src/core");

const now = Date.parse("2026-10-09T14:00:00Z");
const logger = { log() {}, error() {} };
const players = Array.from({ length: 5 }, (_, i) => ({
  player: { name: `p${i}` }, kills: 20, deaths: 15,
  ADR: 80, KAST: 75, rating3: 1.2, roundSwing: 1,
}));
const blind = {
  listTeamMatches: async () => { throw new Error("HTTP 403"); },
  listRecentResults: async () => { throw new Error("HTTP 403"); },
};

test("连续读不到HLTV超过阈值时主动提醒，不再静默漏比赛", async () => {
  const sent = [];
  const messenger = { send: async (messages) => sent.push(...messages) };
  const state = {
    lastRunAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
    lastSuccessfulReadAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
  };
  const updated = await runMonitor({
    state, dataSource: blind, messenger, now, logger,
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /【监控异常】/);
  assert.match(sent[0], /240 分钟/);
  assert.ok(updated.lastBlindAlertAt);
});

test("异常提醒不会每轮重复轰炸群聊", async () => {
  const sent = [];
  const messenger = { send: async (messages) => sent.push(...messages) };
  let state = {
    lastRunAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
    lastSuccessfulReadAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
  };
  state = await runMonitor({ state, dataSource: blind, messenger, now, logger });
  state = await runMonitor({
    state, dataSource: blind, messenger, now: now + 10 * 60 * 1000, logger,
  });
  assert.equal(sent.length, 1);
});

test("恢复读取后发送一次恢复通知", async () => {
  const sent = [];
  const messenger = { send: async (messages) => sent.push(...messages) };
  let state = {
    lastRunAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
    lastSuccessfulReadAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
  };
  state = await runMonitor({ state, dataSource: blind, messenger, now, logger });
  sent.length = 0;
  state = await runMonitor({
    state,
    dataSource: { listTeamMatches: async () => [], listRecentResults: async () => [] },
    messenger,
    now: now + 10 * 60 * 1000,
    logger,
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /【监控恢复】/);
  assert.equal(state.lastBlindAlertAt, null);
});

test("HLTV长时间不出统计时宁可只播报比分，也不漏掉这场", async () => {
  const sent = [];
  const messenger = { send: async (messages) => sent.push(...messages) };
  const broken = structuredClone({ playerStats: { team1: players, team2: players } });
  broken.playerStats.team1[0].rating3 = null;
  const match = {
    id: 123, date: now - 8 * 60 * 60 * 1000, status: "over",
    team1: { id: 6667, name: "FaZe" }, team2: { name: "Spirit" },
    embeddedStats: broken,
    maps: [{ name: "Nuke", result: { team1TotalRounds: 13, team2TotalRounds: 8 } }],
  };
  const dataSource = {
    listTeamMatches: async () => [],
    listRecentResults: async () => [],
    getMatch: async () => match,
  };
  // Still inside the grace period: nothing is sent, and the run is not green.
  let state = await runMonitor({
    state: { matches: { 123: { ...match, overSince: new Date(now - 60_000).toISOString() } } },
    dataSource, messenger, now, logger,
  });
  assert.equal(sent.length, 0);
  assert.equal(state.lastRunStatus, "failed");

  // Past the grace period the score goes out rather than nothing at all.
  state = await runMonitor({
    state: { matches: { 123: { ...match, overSince: new Date(now - 7 * 60 * 60 * 1000).toISOString() } } },
    dataSource, messenger, now, logger,
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /FaZe 1-0 Spirit/);
  assert.match(sent[0], /只播报比分/);
  assert.equal(state.matches[123].resultSent, true);
});
