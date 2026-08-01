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
  return [
    "【FaZe比赛开始】",
    "",
    `${team1} vs ${team2}`,
    `赛事：${match.event?.name || "赛事待定"}`,
    `赛制：${formatType(match)}`,
    `北京时间：${formatBeijingTime(match.date)}`,
    `HLTV比赛编号：${match.id}`,
  ].join("\n");
}

function mapLine(map, team1Name, team2Name) {
  if (!map.result) return `${map.name}：未进行`;
  const t1 = map.result.team1TotalRounds;
  const t2 = map.result.team2TotalRounds;
  const winner = t1 > t2 ? team1Name : t2 > t1 ? team2Name : "平局";
  return `${map.name}：${t1}-${t2}（${winner}）`;
}

function overviewLine(label, pair, digits = null) {
  if (!pair || pair.team1 === undefined || pair.team2 === undefined)
    return null;
  return `${label}：${valueOrDash(pair.team1, digits)} : ${valueOrDash(pair.team2, digits)}`;
}

function playerLine(player) {
  const kd = `${valueOrDash(player.kills)}-${valueOrDash(player.deaths)}`;
  const diff = signed(player.killDeathsDifference);
  const opening =
    player.openingKills === null || player.openingKills === undefined
      ? signed(player.firstKillsDifference)
      : `${player.openingKills}-${player.openingDeaths}`;
  const details = [
    `${player.player.name}｜${kd} (${diff})`,
    `ADR ${valueOrDash(player.ADR, 1)}`,
    `KAST ${valueOrDash(player.KAST, 1)}%`,
    `Swing ${signed(player.roundSwing, "%")}`,
    `R3 ${valueOrDash(player.rating3, 2)}`,
    `首杀 ${opening}`,
    `HS ${valueOrDash(player.hsKills)}`,
    `A/FA ${valueOrDash(player.assists)}/${valueOrDash(player.flashAssists)}`,
  ];
  if (player.multiKillRounds !== null && player.multiKillRounds !== undefined) {
    details.push(`MK ${player.multiKillRounds}`);
  }
  if (player.clutchesWon !== null && player.clutchesWon !== undefined) {
    details.push(`1vX ${player.clutchesWon}`);
  }
  return details.join("｜");
}

function formatResultMessages(match, stats) {
  const [team1Name, team2Name] = teamNames(match);
  const team1Maps = match.maps.filter(
    (map) =>
      map.result && map.result.team1TotalRounds > map.result.team2TotalRounds,
  ).length;
  const team2Maps = match.maps.filter(
    (map) =>
      map.result && map.result.team2TotalRounds > map.result.team1TotalRounds,
  ).length;
  const overview = stats.overview || {};
  const overviewLines = [
    overviewLine("Team Rating 3.0", overview.teamRating, 2),
    overviewLine("首杀", overview.firstKills),
    overviewLine("残局胜利", overview.clutchesWon),
  ].filter(Boolean);

  const summary = [
    "【FaZe赛后战绩】",
    "",
    `${team1Name} ${team1Maps}-${team2Maps} ${team2Name}`,
    `赛事：${match.event?.name || "赛事待定"}`,
    "",
    ...match.maps
      .filter((map) => map.result)
      .map((map) => mapLine(map, team1Name, team2Name)),
    ...(overviewLines.length
      ? ["", `${team1Name} : ${team2Name}`, ...overviewLines]
      : []),
    "",
    "数据说明：R3=Rating 3.0，Swing=Round Swing，FA=闪光助攻，MK=多杀回合，1vX=残局胜利。",
  ].join("\n");

  const teamMessage = (name, players) =>
    [`【${name} 选手数据】`, ...players.map(playerLine)].join("\n");

  return [
    summary,
    teamMessage(stats.team1?.name || team1Name, stats.playerStats.team1),
    teamMessage(stats.team2?.name || team2Name, stats.playerStats.team2),
  ];
}

module.exports = {
  formatBeijingTime,
  formatResultMessages,
  formatStartMessage,
  playerLine,
};

