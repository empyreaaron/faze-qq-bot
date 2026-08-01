"use strict";

function valueOrDash(value, digits = null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return digits === null ? String(value) : Number(value).toFixed(digits);
}

function signed(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number}${suffix}`;
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

function mapLine(map, team1Name, team2Name, swapTeams = false) {
  if (!map.result) return `${map.name}：未进行`;
  const t1 = swapTeams
    ? map.result.team2TotalRounds
    : map.result.team1TotalRounds;
  const t2 = swapTeams
    ? map.result.team1TotalRounds
    : map.result.team2TotalRounds;
  const winner = t1 > t2 ? team1Name : t2 > t1 ? team2Name : "平局";
  return `${map.name}：${t1}-${t2}（${winner}）`;
}

function overviewLine(label, pair, digits = null, swapTeams = false) {
  if (!pair || pair.team1 === undefined || pair.team2 === undefined)
    return null;
  const team1 = swapTeams ? pair.team2 : pair.team1;
  const team2 = swapTeams ? pair.team1 : pair.team2;
  return `${label}：${valueOrDash(team1, digits)} : ${valueOrDash(team2, digits)}`;
}

function playerLine(player) {
  const kd = `${valueOrDash(player.kills)}-${valueOrDash(player.deaths)}`;
  return [
    player.player.name,
    kd,
    signed(player.roundSwing, "%"),
    valueOrDash(player.ADR, 1),
    `${valueOrDash(player.KAST, 1)}%`,
    valueOrDash(player.rating3, 2),
  ].join("｜");
}

function playerTable(name, players) {
  return [
    `【${name} 选手数据】`,
    "选手｜K-D｜Swing｜ADR｜KAST｜Rating",
    ...players.map(playerLine),
  ];
}

function formatResultMessages(match, stats) {
  const [originalTeam1, originalTeam2] = teamNames(match);
  const swapTeams =
    /^faze$/i.test(originalTeam2) && !/^faze$/i.test(originalTeam1);
  const team1Name = swapTeams ? originalTeam2 : originalTeam1;
  const team2Name = swapTeams ? originalTeam1 : originalTeam2;
  const originalTeam1Maps = match.maps.filter(
    (map) =>
      map.result && map.result.team1TotalRounds > map.result.team2TotalRounds,
  ).length;
  const originalTeam2Maps = match.maps.filter(
    (map) =>
      map.result && map.result.team2TotalRounds > map.result.team1TotalRounds,
  ).length;
  const team1Maps = swapTeams ? originalTeam2Maps : originalTeam1Maps;
  const team2Maps = swapTeams ? originalTeam1Maps : originalTeam2Maps;
  const overview = stats.overview || {};
  const overviewLines = [
    overviewLine("Team Rating 3.0", overview.teamRating, 2, swapTeams),
    overviewLine("首杀", overview.firstKills, null, swapTeams),
    overviewLine("残局胜利", overview.clutchesWon, null, swapTeams),
  ].filter(Boolean);
  const team1Stats = swapTeams
    ? stats.playerStats.team2
    : stats.playerStats.team1;
  const team2Stats = swapTeams
    ? stats.playerStats.team1
    : stats.playerStats.team2;

  const message = [
    "【赛后战绩】",
    "",
    `${team1Name} ${team1Maps}-${team2Maps} ${team2Name}`,
    `赛事：${match.event?.name || "赛事待定"}`,
    "",
    "【地图比分】",
    ...match.maps
      .filter((map) => map.result)
      .map((map) => mapLine(map, team1Name, team2Name, swapTeams)),
    ...(overviewLines.length
      ? ["", `${team1Name} : ${team2Name}`, ...overviewLines]
      : []),
    "",
    ...playerTable(team1Name, team1Stats),
    "",
    ...playerTable(team2Name, team2Stats),
  ].join("\n");

  return [message];
}

module.exports = {
  formatBeijingTime,
  formatResultMessages,
  formatStartMessage,
  playerLine,
};
