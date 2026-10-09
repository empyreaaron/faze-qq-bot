"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseMatchHtml,
  parseMatchesHtml,
  parseMatchStatsHtml,
} = require("../src/hltv");

function rows(prefix) {
  return Array.from(
    { length: 5 },
    (_, index) => `
    <tr>
      <td class="st-player"><a href="/stats/players/${100 + index}/${prefix}${index}">${prefix}${index}</a></td>
      <td>7 : 5</td><td>9</td><td>75.0%</td><td>2</td>
      <td>50 (20)</td><td>12 (3)</td><td>40 (6)</td>
      <td>82.5</td><td>75.0%</td><td>+1.25%</td><td>1.20</td>
    </tr>`,
  ).join("");
}

function table(team, prefix, multiplier = 1) {
  return `<table class="stats-table totalstats">
    <thead><tr><th>${team}</th><th>Op.K-D</th><th>MKs</th><th>KAST</th><th>1vsX</th>
      <th>K (hs)</th><th>A (f)</th><th>D (t)</th><th>ADR</th><th>KAST</th><th>Swing</th><th>Rating 3.0</th></tr></thead>
    <tbody>${rows(`${prefix}${multiplier}`)}</tbody>
  </table>`;
}

test("解析当前Rating 3.0表格并选择Both侧统计", () => {
  const html = `<html><body>
    <div class="team-left"><img class="team-logo" title="FaZe"></div>
    <div class="team-right"><img class="team-logo" title="Spirit"></div>
    <div class="match-info-row"><span class="bold">Team rating 3.0</span><span class="right">1.10 : 0.95</span></div>
    ${table("FaZe", "f", 1)}${table("FaZe", "f", 2)}${table("FaZe", "f", 3)}
    ${table("Spirit", "s", 1)}${table("Spirit", "s", 2)}${table("Spirit", "s", 3)}
  </body></html>`;
  const stats = parseMatchStatsHtml(html);
  assert.equal(stats.playerStats.team1.length, 5);
  assert.equal(stats.playerStats.team2.length, 5);
  assert.equal(stats.playerStats.team1[0].player.name, "f10");
  assert.equal(stats.playerStats.team2[0].player.name, "s10");
  assert.equal(stats.playerStats.team1[0].rating3, 1.2);
  assert.equal(stats.playerStats.team1[0].roundSwing, 1.25);
  assert.deepEqual(stats.overview.teamRating, { team1: 1.1, team2: 0.95 });
});

test("解析FaZe赛程列表中的Live比赛", () => {
  const html = `<div class="liveMatch-container" team1="6667" team2="7020">
    <a class="a-reset" href="/matches/2396020/faze-vs-spirit">
      <div class="matchTime matchLive" data-unix="1785597000000">LIVE</div>
      <div class="matchTeamName">FaZe</div><div class="matchTeamName">Spirit</div>
      <div class="matchMeta">bo3</div>
      <img class="matchEventLogo" title="BLAST Test">
    </a>
  </div>`;
  const matches = parseMatchesHtml(html);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 2396020);
  assert.equal(matches[0].team1.name, "FaZe");
  assert.equal(matches[0].live, true);
});

test("解析HLTV新版Live比赛卡片", () => {
  const html = `<div class="match-wrapper live-match-container"
    data-match-wrapper data-match-id="2396020" live="true"
    team1="6667" team2="7020">
    <div class="match-event" data-event-headline="BLAST Test"></div>
    <a href="/matches/2396020/faze-vs-spirit" class="match-info">
      <div class="match-meta match-meta-live">Live</div>
      <div class="match-meta">bo3</div>
    </a>
    <div class="match-teamname">FaZe</div>
    <div class="match-teamname">Spirit</div>
  </div>`;
  const matches = parseMatchesHtml(html);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 2396020);
  assert.deepEqual(matches[0].team1, { id: 6667, name: "FaZe" });
  assert.deepEqual(matches[0].team2, { id: 7020, name: "Spirit" });
  assert.equal(matches[0].format, "bo3");
  assert.equal(matches[0].live, true);
});

test("解析已结束比赛、总统计ID和地图比分", () => {
  const html = `<div class="match-page">
    <div class="timeAndEvent"><div class="date" data-unix="1785597000000"></div>
      <div class="event"><a href="/events/99/test">BLAST Test</a></div></div>
    <div class="countdown">Match over</div>
    <div class="team1-gradient"><a href="/team/6667/faze"><span class="teamName">FaZe</span></a><span class="won"></span></div>
    <div class="team2-gradient"><a href="/team/7020/spirit"><span class="teamName">Spirit</span></a></div>
    <div class="preformatted-text">Best of 3 (LAN) * Quarter-final</div>
    <div class="stats-detailed-stats"><a href="/stats/matches/128904/faze-vs-spirit">stats</a></div>
    <div class="mapholder"><span class="mapname">Nuke</span>
      <span class="results-left"><span class="results-team-score">13</span></span>
      <span class="results-right"><span class="results-team-score">10</span></span>
      <a class="results-stats" href="/stats/matches/mapstatsid/234056/faze-vs-spirit"></a>
    </div>
  </div>`;
  const match = parseMatchHtml(html, 2396020);
  assert.equal(match.status, "over");
  assert.equal(match.statsId, 128904);
  assert.equal(match.winnerTeam.name, "FaZe");
  assert.equal(match.format.type, "bo3");
  assert.deepEqual(match.stage, {
    name: "Quarter-final",
    label: "四分之一决赛",
    isKnockout: true,
  });
  assert.deepEqual(match.maps[0].result, {
    team1TotalRounds: 13,
    team2TotalRounds: 10,
  });
});

test("从比赛页内嵌简表解析双方五项选手数据", () => {
  const compactRows = (prefix) =>
    Array.from(
      { length: 5 },
      (_, index) => `<tr>
        <td class="players"><a href="/player/${200 + index}/${prefix}${index}">
          <span class="player-nick">${prefix}${index}</span></a></td>
        <td class="kd traditional-data">${50 - index}-${40 + index}</td>
        <td class="roundSwing">+${index}.25%</td>
        <td class="adr traditional-data">8${index}.5</td>
        <td class="kast traditional-data">7${index}.0%</td>
        <td class="rating">1.${20 - index}</td>
      </tr>`,
    ).join("");
  const compactTable = (team, prefix) => `<table class="table totalstats">
    <tr class="header-row"><td><a class="teamName">${team}</a></td></tr>
    ${compactRows(prefix)}
  </table>`;
  const html = `<div class="match-page"><div id="all-content">
    ${compactTable("FaZe", "f")}${compactTable("Spirit", "s")}
  </div></div>`;
  const match = parseMatchHtml(html, 4);
  assert.equal(match.embeddedStats.team1.name, "FaZe");
  assert.equal(match.embeddedStats.playerStats.team1.length, 5);
  assert.equal(match.embeddedStats.playerStats.team2.length, 5);
  assert.equal(match.embeddedStats.playerStats.team1[0].kills, 50);
  assert.equal(match.embeddedStats.playerStats.team1[0].deaths, 40);
  assert.equal(match.embeddedStats.playerStats.team1[0].roundSwing, 0.25);
  assert.equal(match.embeddedStats.playerStats.team1[0].ADR, 80.5);
  assert.equal(match.embeddedStats.playerStats.team1[0].KAST, 70);
  assert.equal(match.embeddedStats.playerStats.team1[0].rating3, 1.2);
});

test("小组和瑞士轮不会被误判为淘汰赛", () => {
  const groupHtml = `<div class="match-page">
    <div class="countdown">LIVE</div>
    <div class="preformatted-text">Best of 3 (LAN) * Group A lower bracket semi-final</div>
  </div>`;
  const swissHtml = `<div class="match-page">
    <div class="countdown">LIVE</div>
    <div class="preformatted-text">Best of 3 (LAN) * Swiss round 4 (teams with a 1-2 record)</div>
  </div>`;
  assert.equal(parseMatchHtml(groupHtml, 1).stage.isKnockout, false);
  assert.equal(parseMatchHtml(swissHtml, 2).stage.isKnockout, false);
});

test("解析带阶段编号的半决赛", () => {
  const html = `<div class="match-page">
    <div class="countdown">LIVE</div>
    <div class="preformatted-text">Best of 3 (LAN) * Stage 2 semi-final ** seed note</div>
  </div>`;
  assert.deepEqual(parseMatchHtml(html, 3).stage, {
    name: "Stage 2 semi-final",
    label: "第2阶段半决赛",
    isKnockout: true,
  });
});

test("HLTV状态文字仍为LIVE时根据已完成地图推断BO3结束", () => {
  const completedMap = (name, statsId, left, right) => `<div class="mapholder">
    <span class="mapname">${name}</span>
    <span class="results-left"><span class="results-team-score">${left}</span></span>
    <span class="results-right"><span class="results-team-score">${right}</span></span>
    <a class="results-stats" href="/stats/matches/mapstatsid/${statsId}/test"></a>
  </div>`;
  const html = `<div class="match-page">
    <div class="countdown">LIVE</div>
    <div class="preformatted-text">Best of 3 (LAN) * Semi-final</div>
    ${completedMap("de_dust2", 1, 6, 13)}
    ${completedMap("de_cache", 2, 13, 9)}
    ${completedMap("de_anubis", 3, 11, 13)}
  </div>`;
  assert.equal(parseMatchHtml(html, 5).status, "over");
});

test("进行中的决胜图有临时领先比分时不会误判结束", () => {
  const html = `<div class="match-page">
    <div class="countdown">LIVE</div>
    <div class="preformatted-text">Best of 3 (LAN) * Semi-final</div>
    <div class="mapholder"><span class="mapname">de_dust2</span>
      <span class="results-left"><span class="results-team-score">6</span></span>
      <span class="results-right"><span class="results-team-score">13</span></span>
      <a class="results-stats" href="/stats/matches/mapstatsid/1/test"></a></div>
    <div class="mapholder"><span class="mapname">de_cache</span>
      <span class="results-left"><span class="results-team-score">13</span></span>
      <span class="results-right"><span class="results-team-score">9</span></span>
      <a class="results-stats" href="/stats/matches/mapstatsid/2/test"></a></div>
    <div class="mapholder"><span class="mapname">de_anubis</span>
      <span class="results-left"><span class="results-team-score">13</span></span>
      <span class="results-right"><span class="results-team-score">12</span></span></div>
  </div>`;
  assert.equal(parseMatchHtml(html, 6).status, "live");
});
