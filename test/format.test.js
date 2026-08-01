"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { formatResultMessages, formatStartMessage } = require("../src/format");

const match = {
  id: 123,
  date: Date.parse("2026-08-01T12:30:00Z"),
  team1: { name: "FaZe" },
  team2: { name: "Spirit" },
  event: { name: "BLAST Test" },
  format: { type: "bo3" },
  maps: [
    {
      name: "Nuke",
      result: { team1TotalRounds: 13, team2TotalRounds: 10 },
    },
  ],
};

test("开赛消息包含北京时间、对阵和赛事", () => {
  const text = formatStartMessage(match);
  assert.match(text, /FaZe vs Spirit/);
  assert.match(text, /BLAST Test/);
  assert.match(text, /2026-08-01 20:30/);
});

test("赛后消息包含Rating 3.0完整字段", () => {
  const player = {
    player: { name: "frozen" },
    kills: 50,
    deaths: 40,
    killDeathsDifference: 10,
    ADR: 85.2,
    KAST: 76.4,
    roundSwing: 2.1,
    rating3: 1.27,
    openingKills: 8,
    openingDeaths: 4,
    firstKillsDifference: 4,
    hsKills: 20,
    assists: 12,
    flashAssists: 3,
    multiKillRounds: 9,
    clutchesWon: 2,
  };
  const messages = formatResultMessages(match, {
    team1: { name: "FaZe" },
    team2: { name: "Spirit" },
    overview: {
      teamRating: { team1: 1.1, team2: 0.95 },
      firstKills: { team1: 30, team2: 20 },
    },
    playerStats: { team1: [player], team2: [player] },
  });
  const text = messages.join("\n");
  assert.match(text, /R3 1.27/);
  assert.match(text, /Swing \+2.1%/);
  assert.match(text, /首杀 8-4/);
  assert.match(text, /A\/FA 12\/3/);
});
