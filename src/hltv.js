"use strict";

const cheerio = require("cheerio");
const { gotScraping } = require("got-scraping");

const FAZE_TEAM_ID = 6667;

const MAP_LABELS = {
  tba: "TBA",
  de_train: "Train",
  de_cbble: "Cobblestone",
  de_inferno: "Inferno",
  de_cache: "Cache",
  de_mirage: "Mirage",
  de_overpass: "Overpass",
  de_dust2: "Dust2",
  de_nuke: "Nuke",
  de_tuscan: "Tuscan",
  de_vertigo: "Vertigo",
  de_season: "Season",
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  default: "TBA",
};

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFrom(value) {
  const match = cleanText(value)
    .replace(/,/g, "")
    .match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parsePair(value) {
  const numbers = cleanText(value).match(/[+-]?\d+(?:\.\d+)?/g) || [];
  return numbers.length >= 2
    ? [Number(numbers[0]), Number(numbers[1])]
    : [null, null];
}

function parseCountWithParen(value) {
  const numbers = cleanText(value).match(/\d+(?:\.\d+)?/g) || [];
  return {
    total: numbers[0] === undefined ? null : Number(numbers[0]),
    detail: numbers[1] === undefined ? null : Number(numbers[1]),
  };
}

function matchIdFromHref(href) {
  const match = String(href || "").match(/\/matches\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("live")) return "live";
  if (value.includes("over")) return "over";
  if (value.includes("postpon")) return "postponed";
  if (value.includes("delete")) return "deleted";
  return "scheduled";
}

async function fetchHltvHtml(url) {
  const response = await gotScraping({
    url,
    timeout: { request: 25_000 },
    retry: { limit: 1 },
  });
  const html = response.body;
  if (!html || /Just a moment|cf-chl-|Attention Required/i.test(html)) {
    throw new Error("HLTV返回了Cloudflare验证页");
  }
  return html;
}

function teamFromMatchList($, element, position) {
  const teamElement = $(element)
    .find(".matchTeamName")
    .eq(position - 1);
  const fallback = $(element).find(`.team${position} .team`).first();
  const id = numberFrom($(element).attr(`team${position}`));
  const name = cleanText(teamElement.text() || fallback.text());
  return name ? { id, name } : null;
}

function parseMatchesHtml(html) {
  const $ = cheerio.load(html);
  return $(".liveMatch-container, .upcomingMatch")
    .toArray()
    .map((element) => {
      const link = $(element).find('a.a-reset[href*="/matches/"]').first();
      const href =
        link.attr("href") || $(element).find(".a-reset").first().attr("href");
      const id = matchIdFromHref(href);
      if (!id) return null;
      const time = $(element).find(".matchTime").first();
      const date = numberFrom(time.attr("data-unix"));
      const title =
        cleanText($(element).find(".matchInfoEmpty").text()) || null;
      const eventName = cleanText(
        $(element).find(".matchEventLogo").attr("title") ||
          $(element).find(".matchEventName").text(),
      );
      return {
        id,
        date,
        team1: title ? null : teamFromMatchList($, element, 1),
        team2: title ? null : teamFromMatchList($, element, 2),
        event: eventName ? { name: eventName } : null,
        format: cleanText($(element).find(".matchMeta").text()) || null,
        title,
        live:
          cleanText(time.text()).toUpperCase() === "LIVE" ||
          $(element).hasClass("liveMatch-container"),
      };
    })
    .filter(Boolean);
}

function teamFromMatchPage($, position) {
  const container = $(`.team${position}-gradient`);
  const name = cleanText(container.find(".teamName").text());
  if (!name) return null;
  const href = container.find('a[href*="/team/"]').first().attr("href");
  const idMatch = String(href || "").match(/\/team\/(\d+)/);
  return { id: idMatch ? Number(idMatch[1]) : null, name };
}

function mapStatsIdFromHref(href) {
  const match = String(href || "").match(/\/mapstatsid\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseMap($, element) {
  const name = cleanText($(element).find(".mapname").text()) || "TBA";
  const team1Score = numberFrom(
    $(element).find(".results-left .results-team-score").text(),
  );
  const team2Score = numberFrom(
    $(element).find(".results-right .results-team-score").text(),
  );
  const statsHref = $(element)
    .find('.results-stats[href*="mapstatsid"]')
    .attr("href");
  return {
    name: MAP_LABELS[name] || name,
    statsId: mapStatsIdFromHref(statsHref),
    result:
      team1Score === null || team2Score === null
        ? null
        : {
            team1TotalRounds: team1Score,
            team2TotalRounds: team2Score,
          },
  };
}

function parseMatchHtml(html, matchId) {
  const $ = cheerio.load(html);
  const countdown = cleanText($(".countdown").first().text());
  const pageText = cleanText($(".match-page").text());
  let status = normalizeStatus(countdown);
  if (status === "scheduled" && /Match over/i.test(pageText)) status = "over";
  if (status === "scheduled" && /\bLIVE\b/i.test(countdown)) status = "live";

  const statsHref = $('.stats-detailed-stats a[href*="/stats/matches/"]')
    .toArray()
    .map((link) => $(link).attr("href"))
    .find((href) => href && !href.includes("mapstatsid"));
  const statsMatch = String(statsHref || "").match(/\/stats\/matches\/(\d+)/);
  const team1 = teamFromMatchPage($, 1);
  const team2 = teamFromMatchPage($, 2);
  const winnerTeam = $(".team1-gradient .won").length
    ? team1
    : $(".team2-gradient .won").length
      ? team2
      : null;
  const eventLink = $(".timeAndEvent .event a").first();
  const eventHref = eventLink.attr("href");
  const eventIdMatch = String(eventHref || "").match(/\/events\/(\d+)/);
  const formatText = cleanText($(".preformatted-text").first().text());
  const bestOf = formatText.match(/Best of\s+(\d+)/i);

  return {
    id: Number(matchId),
    date: numberFrom($(".timeAndEvent .date").attr("data-unix")),
    status,
    statsId: statsMatch ? Number(statsMatch[1]) : null,
    team1,
    team2,
    winnerTeam,
    event: cleanText(eventLink.text())
      ? {
          id: eventIdMatch ? Number(eventIdMatch[1]) : null,
          name: cleanText(eventLink.text()),
        }
      : null,
    format: formatText
      ? { type: bestOf ? `bo${bestOf[1]}` : formatText }
      : null,
    maps: $(".mapholder")
      .toArray()
      .map((element) => parseMap($, element)),
  };
}

function findHeaderIndex(headers, matcher, fromEnd = false) {
  if (fromEnd) {
    for (let i = headers.length - 1; i >= 0; i -= 1) {
      if (matcher(headers[i])) return i;
    }
    return -1;
  }
  return headers.findIndex(matcher);
}

function tableTeamName($, table) {
  return cleanText(
    $(table).find("thead .team-logo").first().attr("title") ||
      $(table).find("thead .st-teamname").first().text() ||
      $(table).find("thead th").first().text(),
  ).replace(/\s+(Op\.?K-D|MKs|KAST).*$/i, "");
}

function parsePlayerTable($, table) {
  const headers = $(table)
    .find("thead tr")
    .last()
    .find("th")
    .toArray()
    .map((element) => cleanText($(element).text()));

  const index = {
    opening: findHeaderIndex(headers, (h) => /Op\.?K-D/i.test(h)),
    multiKills: findHeaderIndex(headers, (h) => /^MKs$/i.test(h)),
    clutches: findHeaderIndex(headers, (h) => /1vsX/i.test(h)),
    kills: findHeaderIndex(headers, (h) => /^K\s*\(hs\)$/i.test(h)),
    assists: findHeaderIndex(headers, (h) => /^A\s*\(f\)$/i.test(h)),
    deaths: findHeaderIndex(headers, (h) => /^D\s*\(t\)$/i.test(h)),
    adr: findHeaderIndex(headers, (h) => /^ADR$/i.test(h)),
    kast: findHeaderIndex(headers, (h) => /^KAST$/i.test(h), true),
    swing: findHeaderIndex(headers, (h) => /Swing/i.test(h)),
    rating: findHeaderIndex(headers, (h) => /Rating/i.test(h), true),
  };

  return $(table)
    .find("tbody tr")
    .toArray()
    .map((row) => {
      const cells = $(row)
        .find("td")
        .toArray()
        .map((cell) => cleanText($(cell).text()));
      const playerLink = $(row).find('a[href*="/player/"]').first();
      const playerName = cleanText(
        $(row).find(".st-player a").first().text() || playerLink.text(),
      );
      if (!playerName) return null;

      const cell = (position) => (position >= 0 ? cells[position] : "");
      const [openingKills, openingDeaths] = parsePair(cell(index.opening));
      const kills = parseCountWithParen(cell(index.kills));
      const assists = parseCountWithParen(cell(index.assists));
      const deaths = parseCountWithParen(cell(index.deaths));
      const playerIdMatch = String(playerLink.attr("href") || "").match(
        /\/player\/(\d+)/,
      );

      return {
        player: {
          id: playerIdMatch ? Number(playerIdMatch[1]) : null,
          name: playerName,
        },
        openingKills,
        openingDeaths,
        firstKillsDifference:
          openingKills === null || openingDeaths === null
            ? null
            : openingKills - openingDeaths,
        multiKillRounds: numberFrom(cell(index.multiKills)),
        clutchesWon: numberFrom(cell(index.clutches)),
        kills: kills.total,
        hsKills: kills.detail,
        assists: assists.total,
        flashAssists: assists.detail,
        deaths: deaths.total,
        tradedDeaths: deaths.detail,
        killDeathsDifference:
          kills.total === null || deaths.total === null
            ? null
            : kills.total - deaths.total,
        ADR: numberFrom(cell(index.adr)),
        KAST: numberFrom(cell(index.kast)),
        roundSwing: numberFrom(cell(index.swing)),
        rating3: numberFrom(cell(index.rating)),
      };
    })
    .filter(Boolean);
}

function chooseTeamTables($, tables, team1Name, team2Name) {
  const labeled = tables.map((table) => ({
    table,
    name: tableTeamName($, table),
  }));
  const byName = (target) =>
    labeled.find(
      ({ name }) =>
        target && name && name.toLowerCase().includes(target.toLowerCase()),
    );
  const team1 = byName(team1Name);
  const team2 = byName(team2Name);
  if (team1 && team2 && team1.table !== team2.table) {
    return [team1.table, team2.table];
  }

  if (tables.length < 2) throw new Error("没有找到双方选手统计表");
  return [tables[0], tables[Math.floor(tables.length / 2)]];
}

function parseOverview($) {
  const overview = {};
  $(".match-info-row").each((_, row) => {
    const label = cleanText($(row).find(".bold").text()).toLowerCase();
    const pair = parsePair($(row).find(".right").text());
    if (pair[0] === null || pair[1] === null) return;
    const value = { team1: pair[0], team2: pair[1] };
    if (label.includes("team rating")) overview.teamRating = value;
    if (label.includes("first kills")) overview.firstKills = value;
    if (label.includes("clutches won")) overview.clutchesWon = value;
  });
  return overview;
}

function parseMatchStatsHtml(html) {
  const $ = cheerio.load(html);
  const team1Name = cleanText(
    $(".team-left .team-logo").attr("title") ||
      $(".team-left a").first().text(),
  );
  const team2Name = cleanText(
    $(".team-right .team-logo").attr("title") ||
      $(".team-right a").first().text(),
  );
  const tables = $("table.stats-table.totalstats").toArray();
  const [team1Table, team2Table] = chooseTeamTables(
    $,
    tables,
    team1Name,
    team2Name,
  );
  const team1Players = parsePlayerTable($, team1Table);
  const team2Players = parsePlayerTable($, team2Table);

  if (team1Players.length + team2Players.length < 8) {
    throw new Error(
      `选手统计尚不完整（目前${team1Players.length + team2Players.length}人）`,
    );
  }

  return {
    team1: { name: team1Name || tableTeamName($, team1Table) || "Team 1" },
    team2: { name: team2Name || tableTeamName($, team2Table) || "Team 2" },
    overview: parseOverview($),
    playerStats: {
      team1: team1Players,
      team2: team2Players,
    },
  };
}

class HltvDataSource {
  async listTeamMatches() {
    const html = await fetchHltvHtml(
      `https://www.hltv.org/matches?team=${FAZE_TEAM_ID}`,
    );
    return parseMatchesHtml(html);
  }

  async getMatch(matchId) {
    const html = await fetchHltvHtml(
      `https://www.hltv.org/matches/${Number(matchId)}/-`,
    );
    return parseMatchHtml(html, Number(matchId));
  }

  async getStats(statsId) {
    const html = await fetchHltvHtml(
      `https://www.hltv.org/stats/matches/${statsId}/-`,
    );
    return parseMatchStatsHtml(html);
  }
}

module.exports = {
  FAZE_TEAM_ID,
  HltvDataSource,
  MAP_LABELS,
  parseMatchHtml,
  parseMatchesHtml,
  parseMatchStatsHtml,
};
