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

function parseStage(formatText) {
  const text = cleanText(formatText);
  const detailMatch = text.match(/\*\s*([^*]+?)(?:\*\*|$)/);
  if (!detailMatch) return null;

  const name = cleanText(detailMatch[1]).split(/\.\s/)[0];
  const lower = name.toLowerCase();
  if (!name) return null;

  const excluded = /\bgroup\b|\bswiss\b|\bqualifier\b/.test(lower);
  let round = null;
  if (/grand final/.test(lower)) round = "总决赛";
  else if (/consolidation final/.test(lower)) round = "败者组决赛";
  else if (/round of 32|round-of-32/.test(lower)) round = "三十二强";
  else if (/round of 16|round-of-16/.test(lower)) round = "十六强";
  else if (/quarter[- ]final/.test(lower)) round = "四分之一决赛";
  else if (/semi[- ]final/.test(lower)) round = "半决赛";
  else if (/\bfinal\b/.test(lower)) round = "决赛";
  else if (/playoff/.test(lower)) round = "淘汰赛";

  if (!round || excluded) {
    return { name, label: null, isKnockout: false };
  }

  let prefix = "";
  const stageNumber = lower.match(/stage\s+(\d+)/);
  if (stageNumber) prefix += `第${stageNumber[1]}阶段`;
  if (/upper bracket/.test(lower)) prefix += "胜者组";
  if (/lower bracket/.test(lower)) prefix += "败者组";

  return { name, label: `${prefix}${round}`, isKnockout: true };
}

function isCloudflarePage(html) {
  return /Just a moment|cf-chl-|Attention Required|Enable JavaScript and cookies/i.test(
    String(html || ""),
  );
}

async function requestHtml(url, options = {}) {
  const requestOptions = {
    url,
    timeout: { request: options.timeout || 10_000 },
    retry: { limit: options.retries ?? 0 },
  };
  if (options.headers) requestOptions.headers = options.headers;
  const response = await gotScraping(requestOptions);
  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  if (!response.body) throw new Error("返回内容为空");
  return response.body;
}

function withFreshQuery(url) {
  const target = new URL(url);
  target.searchParams.set("faze_bot_refresh", String(Date.now()));
  return target.toString();
}

function jinaUrl(url) {
  const target = new URL(url);
  return `https://r.jina.ai/https://www.hltv.org${target.pathname}${target.search}`;
}

function readerHeaders(options = {}) {
  const key = options.apiKey ?? process.env.JINA_API_KEY;
  const proxy = options.proxy ?? process.env.JINA_PROXY;
  return {
    "x-respond-with": "html",
    "x-cache-tolerance": options.fresh ? "0" : "60",
    ...(options.fresh ? { "x-no-cache": "true" } : {}),
    ...(key ? {
      Authorization: `Bearer ${key}`,
      "x-engine": "browser",
      "x-respond-timing": "resource-idle",
      "x-timeout": "15",
      ...(proxy ? { "x-proxy": proxy } : {}),
    } : {}),
  };
}

async function requestReaderHtml(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: readerHeaders(options),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const error = new Error(`读取通道 HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const html = await response.text();
      if (!html) throw new Error("返回内容为空");
      return html;
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500 && error.status !== 429) break;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
      }
    }
  }
  throw lastError;
}

async function fetchHltvHtml(url, options = {}) {
  const requestUrl = options.fresh ? withFreshQuery(url) : url;
  try {
    const html = await requestHtml(requestUrl);
    if (isCloudflarePage(html)) {
      throw new Error("HLTV返回了Cloudflare验证页");
    }
    if (options.validate) options.validate(html);
    return html;
  } catch (directError) {
    let html;
    try {
      html = await requestReaderHtml(jinaUrl(requestUrl), options);
    } catch (error) {
      throw new Error(`HLTV直连失败（${directError.message}），${error.message}`);
    }
    if (isCloudflarePage(html)) {
      throw new Error(
        `HLTV直连失败（${directError.message}），备用通道也被Cloudflare拦截。${process.env.JINA_API_KEY ? "已配置认证读取，仍需检查数据通道。" : "匿名读取已不可用；可配置JINA_API_KEY后验证浏览器读取。"}`,
      );
    }
    if (options.validate) options.validate(html);
    console.warn(`HLTV直连失败，已使用备用通道：${directError.message}`);
    return html;
  }
}

function parseResultsHtml(html, { since = 0, now = Date.now() } = {}) {
  const $ = cheerio.load(html);
  const results = new Map();
  $(".result-con").each((_, element) => {
    const row = $(element);
    const href = row.find('a[href*="/matches/"]').first().attr("href");
    const id = matchIdFromHref(href);
    const names = row.find("div.team");
    const team1Name = cleanText(names.first().text());
    const team2Name = cleanText(names.last().text());
    if (!id || !team1Name || !team2Name) throw new Error("赛果列表结构变化，无法识别比赛");
    const date = numberFrom(row.attr("data-zonedgrouping-entry-unix"));
    if (!date) throw new Error(`赛果 ${id} 缺少时间，无法安全补查`);
    if (date < since || date > now) return;
    if (![team1Name, team2Name].some((name) => /^faze$/i.test(name))) return;
    const team = (name) => ({ id: /^faze$/i.test(name) ? FAZE_TEAM_ID : null, name });
    results.set(id, {
      id, date, team1: team(team1Name), team2: team(team2Name),
      event: cleanText(row.find(".event-name").text()) ?
        { name: cleanText(row.find(".event-name").text()) } : null,
      format: /bo\d/i.test(row.find(".map-text").text()) ?
        cleanText(row.find(".map-text").text()) : "bo1",
      live: false, status: "over",
    });
  });
  return [...results.values()];
}

function validateListPage(html, kind) {
  const $ = cheerio.load(html);
  const selectors = kind === "results" ? ".results, .results-all, .results-holder, .result-con" :
    ".matches-page, .matches-container, .upcomingMatchesContainer, [data-match-wrapper], .upcomingMatch, .liveMatch-container";
  if (!$(selectors).length) throw new Error(`没有识别到HLTV${kind === "results" ? "赛果" : "赛程"}页面，拒绝将异常响应当成空列表`);
}

function validateMatchPage(html) {
  const $ = cheerio.load(html);
  if (!teamFromMatchPage($, 1) || !teamFromMatchPage($, 2) || !$(".timeAndEvent .date").attr("data-unix")) {
    throw new Error("比赛页结构不完整，拒绝覆盖已知比赛状态");
  }
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
  return $(
    ".liveMatch-container, .upcomingMatch, .live-match-container, [data-match-wrapper]",
  )
    .toArray()
    .map((element) => {
      const link = $(element).find('a[href*="/matches/"]').first();
      const href =
        link.attr("href") || $(element).find(".a-reset").first().attr("href");
      const id =
        numberFrom($(element).attr("data-match-id")) || matchIdFromHref(href);
      if (!id) return null;
      const time = $(element).find(".matchTime, .match-time").first();
      const date = numberFrom(time.attr("data-unix"));
      const title =
        cleanText($(element).find(".matchInfoEmpty").text()) || null;
      const eventName = cleanText(
        $(element).find(".match-event").attr("data-event-headline") ||
          $(element).find(".matchEventLogo").attr("title") ||
          $(element).find(".matchEventName").text(),
      );
      const modernTeams = $(element).find(".match-teamname");
      const team1 = title
        ? null
        : modernTeams.length
          ? {
              id: numberFrom($(element).attr("team1")),
              name: cleanText(modernTeams.eq(0).text()),
            }
          : teamFromMatchList($, element, 1);
      const team2 = title
        ? null
        : modernTeams.length
          ? {
              id: numberFrom($(element).attr("team2")),
              name: cleanText(modernTeams.eq(1).text()),
            }
          : teamFromMatchList($, element, 2);
      const modernFormat = $(element)
        .find(".match-info .match-meta")
        .toArray()
        .map((item) => cleanText($(item).text()))
        .find((value) => value && value.toLowerCase() !== "live");
      return {
        id,
        date,
        team1: team1?.name ? team1 : null,
        team2: team2?.name ? team2 : null,
        event: eventName ? { name: eventName } : null,
        format:
          modernFormat || cleanText($(element).find(".matchMeta").text()) || null,
        title,
        live:
          cleanText(time.text()).toUpperCase() === "LIVE" ||
          $(element).hasClass("liveMatch-container") ||
          $(element).hasClass("live-match-container") ||
          $(element).attr("live") === "true",
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

function parseCompactPlayerTable($, table) {
  return $(table)
    .find("tr")
    .not(".header-row")
    .toArray()
    .map((row) => {
      const playerLink = $(row).find('a[href*="/player/"]').first();
      const playerName = cleanText(
        $(row).find(".player-nick").first().text() || playerLink.text(),
      );
      if (!playerName) return null;

      const kdValues =
        cleanText($(row).find(".kd.traditional-data").first().text()).match(
          /\d+(?:\.\d+)?/g,
        ) || [];
      const kills = kdValues[0] === undefined ? null : Number(kdValues[0]);
      const deaths = kdValues[1] === undefined ? null : Number(kdValues[1]);
      const playerIdMatch = String(playerLink.attr("href") || "").match(
        /\/player\/(\d+)/,
      );
      return {
        player: {
          id: playerIdMatch ? Number(playerIdMatch[1]) : null,
          name: playerName,
        },
        kills,
        deaths,
        killDeathsDifference:
          kills === null || deaths === null ? null : kills - deaths,
        roundSwing: numberFrom($(row).find(".roundSwing").first().text()),
        ADR: numberFrom($(row).find(".adr.traditional-data").first().text()),
        KAST: numberFrom($(row).find(".kast.traditional-data").first().text()),
        rating3: numberFrom($(row).find(".rating").first().text()),
      };
    })
    .filter(Boolean);
}

function parseCompactMatchStats($) {
  const tables = $("#all-content table.table.totalstats").toArray();
  if (tables.length < 2) return null;

  const tableData = tables.slice(0, 2).map((table) => ({
    name: cleanText($(table).find(".header-row .teamName").first().text()),
    players: parseCompactPlayerTable($, table),
  }));
  if (tableData[0].players.length < 5 || tableData[1].players.length < 5) {
    return null;
  }

  return {
    team1: { name: tableData[0].name || "Team 1" },
    team2: { name: tableData[1].name || "Team 2" },
    overview: {},
    playerStats: {
      team1: tableData[0].players,
      team2: tableData[1].players,
    },
  };
}

function inferSeriesStatus(status, maps, bestOf) {
  if (status === "over" || !bestOf) return status;
  const winsNeeded = Math.floor(Number(bestOf) / 2) + 1;
  let team1Wins = 0;
  let team2Wins = 0;

  for (const map of maps) {
    // HLTV在进行中的地图也会显示临时比分，但结束后才会给出mapstatsid。
    // 只用已经生成统计页的地图推断整场结果，避免在13-12等实时比分时误判。
    if (!map.statsId || !map.result) continue;
    if (map.result.team1TotalRounds > map.result.team2TotalRounds) team1Wins += 1;
    if (map.result.team2TotalRounds > map.result.team1TotalRounds) team2Wins += 1;
  }

  return Math.max(team1Wins, team2Wins) >= winsNeeded ? "over" : status;
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

  const maps = $(".mapholder")
    .toArray()
    .map((element) => parseMap($, element));
  status = inferSeriesStatus(status, maps, bestOf ? Number(bestOf[1]) : null);

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
    stage: parseStage(formatText),
    format: formatText
      ? { type: bestOf ? `bo${bestOf[1]}` : formatText }
      : null,
    maps,
    embeddedStats: parseCompactMatchStats($),
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

  if (team1Players.length < 5 || team2Players.length < 5) {
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
  constructor({ fetchPage = fetchHltvHtml } = {}) { this.fetchPage = fetchPage; }

  async listTeamMatches() {
    const html = await this.fetchPage(
      `https://www.hltv.org/matches?team=${FAZE_TEAM_ID}`,
      { fresh: true, validate: (html) => validateListPage(html, "matches") },
    );
    validateListPage(html, "matches");
    return parseMatchesHtml(html).filter(
      (match) =>
        match.team1?.id === FAZE_TEAM_ID || match.team2?.id === FAZE_TEAM_ID ||
        /^faze$/i.test(match.team1?.name || "") || /^faze$/i.test(match.team2?.name || ""),
    );
  }

  async listRecentResults({ since, now = Date.now() }) {
    const params = new URLSearchParams({
      team: String(FAZE_TEAM_ID),
      startDate: new Date(since).toISOString().slice(0, 10),
      endDate: new Date(now).toISOString().slice(0, 10),
    });
    const html = await this.fetchPage(`https://www.hltv.org/results?${params}`, {
      fresh: true, validate: (html) => validateListPage(html, "results"),
    });
    validateListPage(html, "results");
    return parseResultsHtml(html, { since, now });
  }

  async getMatch(matchId) {
    const html = await this.fetchPage(
      `https://www.hltv.org/matches/${Number(matchId)}/-`,
      { fresh: true, validate: validateMatchPage },
    );
    validateMatchPage(html);
    return parseMatchHtml(html, Number(matchId));
  }

  async getStats(statsId) {
    const html = await this.fetchPage(
      `https://www.hltv.org/stats/matches/${statsId}/-`,
      { fresh: true, validate: parseMatchStatsHtml },
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
  parseStage,
  inferSeriesStatus,
  parseResultsHtml,
  validateMatchPage,
  validateListPage,
  readerHeaders,
};
