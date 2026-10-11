"use strict";

function valueOrDash(value, digits = null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return digits === null ? String(value) : Number(value).toFixed(digits);
}

function signed(value, suffix = "", digits = null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const number = Number(value);
  const displayed = digits === null ? String(number) : number.toFixed(digits);
  return `${number > 0 ? "+" : ""}${displayed}${suffix}`;
}

function formatBeijingTime(timestamp) {
  if (!timestamp) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(timestamp))
    .replaceAll("/", "-");
}

function formatBeijingClock(timestamp) {
  if (!timestamp) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function teamNames(match) {
  return [match.team1?.name || "TBA", match.team2?.name || "TBA"];
}

function formatType(match) {
  if (!match.format) return "赛制待定";
  if (typeof match.format === "string") return match.format.toUpperCase();
  return String(match.format.type || "赛制待定").toUpperCase();
}

function formatStartMessage(match) {
  const [team1, team2] = teamNames(match);
  const round = String(match.stage?.label || "淘汰赛").replace(
    /^第\d+阶段/,
    "",
  );
  const startTitle = match.stage?.isKnockout
    ? `【${round}开赛】`
    : "【FaZe比赛开赛】";
  return [
    "@全体成员",
    "",
    startTitle,
    `${team1} vs ${team2}`,
    `赛事：${match.event?.name || "赛事待定"}`,
    `赛制：${formatType(match)}`,
    `北京时间：${formatBeijingClock(match.date)}`,
  ].join("\n");
}

function mapLine(map, swapTeams = false) {
  if (!map.result) return `${map.name}：未进行`;
  const t1 = swapTeams
    ? map.result.team2TotalRounds
    : map.result.team1TotalRounds;
  const t2 = swapTeams
    ? map.result.team1TotalRounds
    : map.result.team2TotalRounds;
  const result = t1 > t2 ? "胜" : t2 > t1 ? "负" : "平";
  return `${map.name}｜${t1}-${t2}｜${result}`;
}

function playerLine(player) {
  const kd = `${valueOrDash(player.kills)}-${valueOrDash(player.deaths)}`;
  return [
    `${player.player.name}｜${kd}｜${valueOrDash(player.rating3, 2)}`,
    `└ ${valueOrDash(player.ADR, 1)}｜${valueOrDash(player.KAST, 1)}%｜${signed(player.roundSwing, "%", 2)}`,
  ];
}

function playerTable(name, players) {
  return [
    `【${name}】`,
    "选手｜K-D｜Rating",
    "└ ADR｜KAST｜Swing",
    "",
    ...players.flatMap(playerLine),
  ];
}

// FaZe is always shown on the left, whichever side HLTV lists them on.
function resultScoreboard(match) {
  const [originalTeam1, originalTeam2] = teamNames(match);
  const swapTeams =
    /^faze$/i.test(originalTeam2) && !/^faze$/i.test(originalTeam1);
  const maps = Array.isArray(match.maps) ? match.maps : [];
  const originalTeam1Maps = maps.filter(
    (map) =>
      map.result && map.result.team1TotalRounds > map.result.team2TotalRounds,
  ).length;
  const originalTeam2Maps = maps.filter(
    (map) =>
      map.result && map.result.team2TotalRounds > map.result.team1TotalRounds,
  ).length;
  return {
    swapTeams,
    team1Name: swapTeams ? originalTeam2 : originalTeam1,
    team2Name: swapTeams ? originalTeam1 : originalTeam2,
    team1Maps: swapTeams ? originalTeam2Maps : originalTeam1Maps,
    team2Maps: swapTeams ? originalTeam1Maps : originalTeam2Maps,
    maps,
  };
}

function resultHeaderLines(board, match) {
  return [
    "【赛后战绩】",
    "",
    `${board.team1Name} ${board.team1Maps}-${board.team2Maps} ${board.team2Name}`,
    `赛事：${match.event?.name || "赛事待定"}`,
    "",
    "【地图比分】",
    ...board.maps
      .filter((map) => map.result)
      .map((map) => mapLine(map, board.swapTeams)),
  ];
}

function formatResultMessages(match, stats) {
  const board = resultScoreboard(match);
  const team1Stats = board.swapTeams
    ? stats.playerStats.team2
    : stats.playerStats.team1;
  const team2Stats = board.swapTeams
    ? stats.playerStats.team1
    : stats.playerStats.team2;

  const message = [
    ...resultHeaderLines(board, match),
    "",
    ...playerTable(board.team1Name, team1Stats),
    "",
    ...playerTable(board.team2Name, team2Stats),
  ].join("\n");

  return [message];
}

// Last resort when HLTV never publishes usable player stats (forfeits, pages
// that stay broken for hours). Missing the result entirely is worse than
// posting the score, so after the grace period this goes out instead.
function formatScoreOnlyResultMessages(match, reason = "") {
  const board = resultScoreboard(match);
  const message = [
    ...resultHeaderLines(board, match),
    "",
    `（HLTV未提供完整选手统计${reason ? `：${reason}` : ""}，本场只播报比分）`,
  ].join("\n");
  return [message];
}

module.exports = {
  formatBeijingTime,
  formatResultMessages,
  formatScoreOnlyResultMessages,
  formatStartMessage,
  playerLine,
};
