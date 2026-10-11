"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runMonitor, shouldInspect, shouldRefresh } = require("../src/core");
const { executeMonitor } = require("../src/index");
const { parseResultsHtml, HltvDataSource, inferSeriesStatus } = require("../src/hltv");

const now = Date.parse("2026-10-09T14:00:00Z");
const logger = { log() {}, error() {} };
const players = Array.from({ length: 5 }, (_, i) => ({
  player: { name: `p${i}` }, kills: 20, deaths: 15,
  ADR: 80, KAST: 75, rating3: 1.2, roundSwing: 1,
}));
const stats = { playerStats: { team1: players, team2: players } };
const preview = { id: 123, date: now - 24 * 60 * 60 * 1000,
  team1: { id: 6667, name: "FaZe" }, team2: { name: "Sangal" }, status: "over" };
const result = { ...preview, embeddedStats: stats, maps: [{ name: "Nuke",
  statsId: 10, result: { team1TotalRounds: 13, team2TotalRounds: 8 } }] };
const source = () => ({ listTeamMatches: async () => [],
  listRecentResults: async () => [preview], getMatch: async () => result });

test("任何选手缺少原版字段时不能发送缩水统计，恢复后补发", async () => {
  const incomplete = structuredClone(result);
  incomplete.embeddedStats.playerStats.team1[0].roundSwing = null;
  const sent = [];
  const messenger = { send: async (messages) => sent.push(...messages) };
  const first = await runMonitor({ state: {}, dataSource: { ...source(), getMatch: async () => incomplete },
    messenger, now, logger });
  assert.equal(sent.length, 0);
  assert.equal(first.matches[123].resultSent, false);
  assert.match(first.lastRunErrors.join(" "), /统计不完整/);
  await runMonitor({ state: first, dataSource: source(), messenger, now: now + 300000, logger });
  assert.equal(sent.length, 1);
});

test("发送后状态保存失败立即停止，不能继续发送下一场", async () => {
  const sent = [];
  let checkpoints = 0;
  const fatal = Object.assign(new Error("保存失败"), { statePersistence: true });
  await assert.rejects(runMonitor({ state: {}, dataSource: { ...source(),
    listRecentResults: async () => [preview, { ...preview, id: 456 }],
    getMatch: async (id) => ({ ...result, id }) },
    messenger: { send: async (messages) => sent.push(...messages) }, now, logger,
    checkpoint: async () => { if (++checkpoints > 1) throw fatal; },
  }), /保存失败/);
  assert.equal(sent.length, 1);
});

test("补查使用可用的队伍赛果页，日期窗口在本地筛选", async () => {
  let requested;
  const dataSource = new HltvDataSource({ fetchPage: async (url) => {
    requested = url;
    return '<div class="results-holder"></div>';
  } });
  assert.deepEqual(await dataSource.listRecentResults({ since: now - 1000, now }), []);
  assert.equal(requested, "https://www.hltv.org/results?team=6667");
});

test("整场比赛在停机期间完成，恢复后从赛果列表补发且不重复", async () => {
  const sent = [];
  const messenger = { send: async (messages) => sent.push(...messages) };
  const first = await runMonitor({ state: {}, dataSource: source(), messenger, now, logger });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /赛后战绩/);
  assert.equal(first.matches[123].startSent, false);
  assert.equal(first.matches[123].resultSent, true);
  await runMonitor({ state: first, dataSource: source(), messenger, now: now + 31 * 60 * 1000, logger });
  assert.equal(sent.length, 1);
});

test("QQ发送失败时保留未发送标记，下次成功再标记", async () => {
  const first = await runMonitor({ state: {}, dataSource: source(),
    messenger: { send: async () => { throw new Error("QQ unavailable"); } }, now, logger });
  assert.equal(first.lastRunStatus, "failed");
  assert.equal(first.matches[123].resultSent, false);
  const second = await runMonitor({ state: first, dataSource: source(),
    messenger: { send: async () => {} }, now: now + 5 * 60 * 1000, logger });
  assert.equal(second.matches[123].resultSent, true);
  assert.equal(second.lastRunStatus, "success");
});

test("抓取全失败仍先保存状态，然后抛错，不能显示绿色成功", async () => {
  let saved;
  await assert.rejects(executeMonitor({ state: {},
    dataSource: { listTeamMatches: async () => { throw new Error("Cloudflare"); },
      listRecentResults: async () => { throw new Error("Cloudflare"); } },
    messenger: { send: async () => assert.fail("不应发送") },
    save: async (value) => { saved = structuredClone(value); }, now, logger }), /监控失败/);
  assert.equal(saved.lastRunStatus, "failed");
  assert.equal(saved.lastScheduleCheckAt, null);
  assert.equal(saved.lastResultsCheckAt, undefined);
});

test("另一场抓取失败不能丢掉已成功发送的标记", async () => {
  let saved;
  const initial = { matches: { 456: { ...preview, id: 456, resultSent: false } } };
  await assert.rejects(executeMonitor({ state: initial,
    dataSource: { ...source(), getMatch: async (id) => {
      if (id === 456) throw new Error("HTTP 403");
      return result;
    } }, messenger: { send: async () => {} },
    save: async (value) => { saved = structuredClone(value); }, now, logger }), /监控失败/);
  assert.equal(saved.matches[123].resultSent, true);
  assert.equal(saved.matches[456].resultSent, false);
});

test("dry_run成功也不会持久化发送标记或覆盖真实状态", async () => {
  const updated = await executeMonitor({ state: {}, dataSource: source(),
    messenger: { send: async () => {} },
    save: async () => assert.fail("dry_run不可写入状态"), now, logger, dryRun: true });
  assert.equal(updated.matches[123].resultSent, true);
});

test("每5分钟更新发现赛程，延期比赛恢复后也能重新检查", () => {
  assert.equal(shouldRefresh({ lastScheduleCheckAt: new Date(now - 5 * 60 * 1000).toISOString() }, now), true);
  assert.equal(shouldInspect({ status: "postponed" }, now), true);
  assert.equal(shouldInspect({ status: "postponed", lastCheckedAt: new Date(now).toISOString() }, now), false);
});

test("补查有边界，按编号去重，并过滤非FaZe比赛", () => {
  const row = (id, date, name = "FaZe") => `<div class="result-con" data-zonedgrouping-entry-unix="${date}">
    <a href="/matches/${id}/test"><div class="team">${name}</div><div class="team">Spirit</div>
    <div class="event-name">Test</div><span class="map-text">bo3</span></a></div>`;
  const parsed = parseResultsHtml(row(1, now - 1000) + row(1, now - 1000) + row(2, now - 100000)
    + row(3, now - 1000, "Vitality"), { since: now - 10000, now });
  assert.deepEqual(parsed.map((m) => m.id), [1]);
  assert.equal(parsed[0].status, "over");
});

test("异常200页面或残缺比赛页必须报错，不能更新为空赛程", async () => {
  const bad = new HltvDataSource({ fetchPage: async () => "<html>service unavailable</html>" });
  await assert.rejects(bad.listTeamMatches(), /拒绝/);
  await assert.rejects(bad.listRecentResults({ since: now - 10000, now }), /拒绝/);
  await assert.rejects(bad.getMatch(1), /拒绝/);
});

test("BO5和加时须确认结束，不因临时领先比分提前发赛果", () => {
  const done = (left, right) => ({ statsId: 1, result: { team1TotalRounds: left, team2TotalRounds: right } });
  assert.equal(inferSeriesStatus("live", [done(16, 14), done(19, 17)], 3), "over");
  assert.equal(inferSeriesStatus("live", [done(16, 14), done(19, 17)], 5), "live");
  assert.equal(inferSeriesStatus("live", [done(16, 14), done(19, 17), done(13, 8)], 5), "over");
  assert.equal(inferSeriesStatus("live", [done(13, 8), { ...done(16, 15), statsId: null }], 3), "live");
});

test("检查预算不会丢掉队列，后续运行轮转到未检查比赛", async () => {
  const seen = [];
  const matches = Object.fromEntries([123, 124, 125].map((id) => [id, { ...preview, id }]));
  const dataSource = { listTeamMatches: async () => [], getMatch: async (id) => {
    seen.push(id); return { ...preview, id, status: "over", maps: [] };
  } };
  const first = await runMonitor({ state: { matches }, dataSource,
    messenger: { send: async () => assert.fail("统计不完整") }, now, logger, maxMatches: 1 });
  await runMonitor({ state: first, dataSource,
    messenger: { send: async () => {} }, now: now + 5 * 60 * 1000, logger, maxMatches: 1 });
  assert.deepEqual(seen, [123, 124]);
  assert.equal(Object.keys(first.matches).length, 3);
});
