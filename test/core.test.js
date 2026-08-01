"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runMonitor } = require("../src/core");

function matchDetails(status, overrides = {}) {
  return {
    id: 123,
    date: Date.parse("2026-08-01T12:30:00Z"),
    status,
    statsId: status === "over" ? 456 : null,
    team1: { id: 6667, name: "FaZe" },
    team2: { id: 7020, name: "Spirit" },
    event: { id: 1, name: "Test Event" },
    format: { type: "bo3" },
    maps: [],
    ...overrides,
  };
}

test("比赛Live时只发送一次开赛提醒", async () => {
  const sent = [];
  const dataSource = {
    listTeamMatches: async () => [
      {
        id: 123,
        date: Date.parse("2026-08-01T12:30:00Z"),
        team1: { id: 6667, name: "FaZe" },
        team2: { id: 7020, name: "Spirit" },
        live: true,
      },
    ],
    getMatch: async () => matchDetails("live"),
  };
  const messenger = { send: async (messages) => sent.push(...messages) };

  const first = await runMonitor({
    state: {},
    dataSource,
    messenger,
    now: Date.parse("2026-08-01T12:31:00Z"),
    logger: { log() {}, error() {} },
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /FaZe比赛开始/);
  assert.equal(first.matches["123"].startSent, true);

  await runMonitor({
    state: first,
    dataSource,
    messenger,
    now: Date.parse("2026-08-01T12:41:00Z"),
    logger: { log() {}, error() {} },
  });
  assert.equal(sent.length, 1);
});

test("首次检查时比赛已经结束，不补发开赛提醒，只发赛果", async () => {
  const sent = [];
  const players = ["a", "b", "c", "d", "e"].map((name) => ({
    player: { name },
    kills: 20,
    deaths: 15,
    killDeathsDifference: 5,
    ADR: 80,
    KAST: 75,
    rating3: 1.2,
    firstKillsDifference: 2,
    openingKills: null,
    openingDeaths: null,
    hsKills: 10,
    assists: 5,
    flashAssists: 1,
    multiKillRounds: 4,
    clutchesWon: 1,
    roundSwing: 1.1,
  }));
  const dataSource = {
    listTeamMatches: async () => [],
    getMatch: async () =>
      matchDetails("over", {
        maps: [
          {
            name: "Nuke",
            result: { team1TotalRounds: 13, team2TotalRounds: 8 },
          },
        ],
      }),
    getStats: async () => ({
      team1: { name: "FaZe" },
      team2: { name: "Spirit" },
      overview: {},
      playerStats: { team1: players, team2: players },
    }),
  };
  const initial = {
    matches: {
      123: {
        id: 123,
        date: Date.parse("2026-08-01T12:30:00Z"),
        startSent: false,
        resultSent: false,
      },
    },
  };

  const result = await runMonitor({
    state: initial,
    dataSource,
    messenger: { send: async (messages) => sent.push(...messages) },
    now: Date.parse("2026-08-01T15:00:00Z"),
    logger: { log() {}, error() {} },
  });
  assert.equal(
    sent.some((message) => message.includes("比赛开始")),
    false,
  );
  assert.equal(
    sent.some((message) => message.includes("赛后战绩")),
    true,
  );
  assert.equal(result.matches["123"].resultSent, true);
});
