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
      .map((map) => mapLine(map, swapTeams)),
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
