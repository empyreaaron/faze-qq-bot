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
  assert.match(text, /^@全体成员\n\n【FaZe比赛开赛】/);
  assert.match(text, /FaZe vs Spirit/);
  assert.match(text, /BLAST Test/);
  assert.match(text, /北京时间：20:30/);
  assert.doesNotMatch(text, /2026-08-01|HLTV比赛编号/);
});

test("淘汰赛使用特殊标题并标明轮次", () => {
  const text = formatStartMessage({
    ...match,
    stage: {
      name: "Stage 2 semi-final",
      label: "第2阶段半决赛",
      isKnockout: true,
    },
  });
  assert.match(text, /^@全体成员\n\n【半决赛开赛】\nFaZe vs Spirit/);
  assert.doesNotMatch(text, /第2阶段/);
});

test("赛后战绩合并为一条并只显示五项选手数据", () => {
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
  assert.equal(messages.length, 1);
  const text = messages.join("\n");
  assert.equal(
    (text.match(/选手｜K-D｜Rating/g) || []).length,
    2,
  );
  assert.equal((text.match(/└ ADR｜KAST｜Swing/g) || []).length, 2);
  assert.match(text, /FaZe 1-0 Spirit/);
  assert.match(text, /【地图比分】\nNuke｜13-10｜胜/);
  assert.match(text, /frozen｜50-40｜1.27\n└ 85.2｜76.4%｜\+2.10%/);
  assert.doesNotMatch(text, /R3|首杀 8-4|A\/FA|HS 20|MK 9|1vX 2/);
});

test("HLTV把FaZe列在右侧时仍将FaZe比分和选手表放在前面", () => {
  const fazePlayer = {
    player: { name: "frozen" },
    kills: 40,
    deaths: 30,
    roundSwing: 2,
    ADR: 85,
    KAST: 75,
    rating3: 1.2,
  };
  const opponentPlayer = {
    ...fazePlayer,
    player: { name: "donk" },
  };
  const reversedMatch = {
    ...match,
    team1: { name: "Spirit" },
    team2: { name: "FaZe" },
    maps: [
      {
        name: "Nuke",
        result: { team1TotalRounds: 10, team2TotalRounds: 13 },
      },
      {
        name: "Mirage",
        result: { team1TotalRounds: 13, team2TotalRounds: 9 },
      },
      {
        name: "Ancient",
        result: { team1TotalRounds: 7, team2TotalRounds: 13 },
      },
    ],
  };
  const text = formatResultMessages(reversedMatch, {
    team1: { name: "Spirit" },
    team2: { name: "FaZe" },
    overview: {},
    playerStats: {
      team1: [opponentPlayer],
      team2: [fazePlayer],
    },
  })[0];

  assert.match(text, /FaZe 2-1 Spirit/);
  assert.match(text, /Nuke｜13-10｜胜/);
  assert.match(text, /Mirage｜9-13｜负/);
  assert.match(text, /Ancient｜13-7｜胜/);
  assert.ok(text.indexOf("【FaZe】") < text.indexOf("【Spirit】"));
});
