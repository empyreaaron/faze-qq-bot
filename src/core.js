"use strict";

const { formatResultMessages, formatStartMessage } = require("./format");

const SCHEDULE_REFRESH_MS = 5 * 60 * 1000;
const RESULTS_REFRESH_MS = 30 * 60 * 1000;
const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const INSPECT_BEFORE_START_MS = 45 * 60 * 1000;
const KEEP_MATCH_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000;

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function normalizeState(input) {
  return {
    ...input,
    schemaVersion: 1,
    lastScheduleCheckAt: input?.lastScheduleCheckAt || null,
    lastHeartbeatAt: input?.lastHeartbeatAt || null,
    matches:
      input?.matches && typeof input.matches === "object" ? input.matches : {},
  };
}

function mergePreview(record, preview, now) {
  return {
    ...record,
    id: Number(preview.id),
    date: preview.date || record.date || null,
    team1: preview.team1 || record.team1 || null,
    team2: preview.team2 || record.team2 || null,
    event: preview.event || record.event || null,
    format: record.format || preview.format || null,
    title: preview.title || record.title || null,
    liveFromList: Boolean(preview.live),
    discoveredAt: record.discoveredAt || iso(now),
    lastSeenAt: iso(now),
    status: ["over", "deleted"].includes(record.status) ? record.status :
      preview.status || record.status || "scheduled",
    startSent: Boolean(record.startSent),
    resultSent: Boolean(record.resultSent),
  };
}

function mergeDetails(record, details, now) {
  return {
    ...record,
    ...details,
    team1: details.team1 || record.team1,
    team2: details.team2 || record.team2,
    event: details.event || record.event,
    format: details.format || record.format,
    date: details.date || record.date,
    startSent: Boolean(record.startSent),
    resultSent: Boolean(record.resultSent),
    lastCheckedAt: iso(now),
    lastError: null,
  };
}

function shouldRefresh(state, now) {
  if (!state.lastScheduleCheckAt) return true;
  return now - Date.parse(state.lastScheduleCheckAt) >= SCHEDULE_REFRESH_MS;
}

function shouldInspect(record, now) {
  if (
    record.resultSent ||
    record.status === "deleted"
  )
    return false;
  if (record.liveFromList || record.startSent || record.status === "live")
    return true;
  if (record.status === "over") return true;
  if (record.status === "postponed")
    return !record.lastCheckedAt || now - Date.parse(record.lastCheckedAt) >= RESULTS_REFRESH_MS;
  if (!record.date) return false;
  return now >= record.date - INSPECT_BEFORE_START_MS;
}

function pruneMatches(state, now) {
  for (const [id, match] of Object.entries(state.matches)) {
    const reference = match.date || Date.parse(match.discoveredAt || 0);
    if (
      reference &&
      now - reference > KEEP_MATCH_MS &&
      (match.resultSent || match.status === "deleted")
    ) {
      delete state.matches[id];
    }
  }
}

async function runMonitor({
  state: inputState,
  dataSource,
  messenger,
  now = Date.now(),
  logger = console,
  checkpoint = async () => {},
  deadline = Infinity,
  maxMatches = 4,
}) {
  const state = normalizeState(inputState);
  const errors = [];
  const fail = (message) => { errors.push(message); logger.error(message); };
  const previousRun = Date.parse(state.lastRunAt || "");
  state.lastRunGapMs = Number.isFinite(previousRun) ? now - previousRun : null;
  if (state.lastRunGapMs > 15 * 60 * 1000) {
    logger.log(`距离上次运行已超过15分钟（${Math.round(state.lastRunGapMs / 60_000)}分钟）；本次尝试补查近期赛果。`);
    state.lastResultsCheckAt = null;
  }
  state.lastRunAt = iso(now);
  const mergePreviews = (previews) => {
    for (const preview of previews) {
      const id = String(preview.id);
      state.matches[id] = mergePreview(state.matches[id] || {}, preview, now);
    }
  };
  let checked = 0;

  if (shouldRefresh(state, now)) {
    try {
      const previews = await dataSource.listTeamMatches();
      mergePreviews(previews);
      state.lastScheduleCheckAt = iso(now);
      logger.log(
        `赛程刷新完成，当前记录 ${Object.keys(state.matches).length} 场。`,
      );
    } catch (error) {
      fail(`刷新HLTV赛程失败：${error.message}`);
    }
  }

  if (dataSource.listRecentResults &&
      (!state.lastResultsCheckAt || now - Date.parse(state.lastResultsCheckAt) >= RESULTS_REFRESH_MS)) {
    if (Date.now() < deadline) {
      try {
        const previews = await dataSource.listRecentResults({ since: now - RECOVERY_MS, now });
        mergePreviews(previews);
        state.lastResultsCheckAt = iso(now);
        logger.log(`近期赛果补查完成，发现 ${previews.length} 场。`);
      } catch (error) {
        fail(`补查HLTV近期赛果失败：${error.message}`);
      }
    } else fail("运行时间不足，近期赛果补查留待下次。");
  }
  await checkpoint(state);

  const records = Object.values(state.matches)
    .filter((match) => shouldInspect(match, now))
    .sort((a, b) => {
      const priority = (m) => m.status === "live" || m.liveFromList ? 0 :
        m.date && Math.abs(now - m.date) < 12 * 60 * 60 * 1000 ? 1 : 2;
      return priority(a) - priority(b) ||
        (Date.parse(a.lastCheckedAt || 0) || 0) - (Date.parse(b.lastCheckedAt || 0) || 0);
    });

  for (const original of records) {
    if (checked >= maxMatches || Date.now() >= deadline) {
      logger.log(`剩余 ${records.length - checked} 场留待下次检查。`);
      break;
    }
    checked += 1;
    const id = String(original.id);
    try {
      const details = await dataSource.getMatch(original.id);
      const match = mergeDetails(state.matches[id], details, now);
      state.matches[id] = match;

      if (match.status === "live" && !match.startSent) {
        await messenger.send([formatStartMessage(match)]);
        match.startSent = true;
        match.startSentAt = iso(now);
        logger.log(`已发送开赛提醒：${match.id}`);
        await checkpoint(state);
      }

      if (match.status === "over" && !match.resultSent) {
        if (!match.embeddedStats && !match.statsId) {
          logger.log(`比赛 ${match.id} 已结束，等待HLTV完整统计。`);
          continue;
        }
        const stats =
          match.embeddedStats || (await dataSource.getStats(match.statsId));
        await messenger.send(formatResultMessages(match, stats));
        match.resultSent = true;
        match.resultSentAt = iso(now);
        logger.log(`已发送赛后统计：${match.id}`);
        await checkpoint(state);
      }
    } catch (error) {
      state.matches[id].lastCheckedAt = iso(now);
      state.matches[id].lastError = error.message;
      fail(`检查比赛 ${original.id} 失败：${error.message}`);
    }
  }

  if (
    !state.lastHeartbeatAt ||
    now - Date.parse(state.lastHeartbeatAt) >= HEARTBEAT_MS
  ) {
    state.lastHeartbeatAt = iso(now);
  }
  pruneMatches(state, now);
  state.lastRunErrors = errors;
  state.lastRunStatus = errors.length ? "failed" : "success";
  if (!errors.length) state.lastSuccessfulRunAt = iso(now);
  logger.log(`本次检查 ${checked} 场，错误 ${errors.length} 个。`);
  return state;
}

module.exports = {
  normalizeState,
  runMonitor,
  shouldInspect,
  shouldRefresh,
};
