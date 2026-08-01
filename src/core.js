"use strict";

const { formatResultMessages, formatStartMessage } = require("./format");

const SCHEDULE_REFRESH_MS = 4 * 60 * 60 * 1000;
const INSPECT_BEFORE_START_MS = 45 * 60 * 1000;
const KEEP_MATCH_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000;

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

function normalizeState(input) {
  return {
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
    format: preview.format || record.format || null,
    title: preview.title || record.title || null,
    liveFromList: Boolean(preview.live),
    discoveredAt: record.discoveredAt || iso(now),
    lastSeenAt: iso(now),
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
  };
}

function shouldRefresh(state, now) {
  if (!state.lastScheduleCheckAt) return true;
  return now - Date.parse(state.lastScheduleCheckAt) >= SCHEDULE_REFRESH_MS;
}

function shouldInspect(record, now) {
  if (
    record.resultSent ||
    record.status === "deleted" ||
    record.status === "postponed"
  )
    return false;
  if (record.liveFromList || record.startSent || record.status === "live")
    return true;
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
}) {
  const state = normalizeState(inputState);

  if (shouldRefresh(state, now)) {
    try {
      const previews = await dataSource.listTeamMatches();
      for (const preview of previews) {
        const id = String(preview.id);
        state.matches[id] = mergePreview(state.matches[id] || {}, preview, now);
      }
      state.lastScheduleCheckAt = iso(now);
      logger.log(
        `赛程刷新完成，当前记录 ${Object.keys(state.matches).length} 场。`,
      );
    } catch (error) {
      logger.error(`刷新HLTV赛程失败：${error.message}`);
    }
  }

  const records = Object.values(state.matches)
    .filter((match) => shouldInspect(match, now))
    .sort((a, b) => (a.date || 0) - (b.date || 0));

  for (const original of records) {
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
      }

      if (match.status === "over" && !match.resultSent) {
        if (!match.statsId) {
          logger.log(`比赛 ${match.id} 已结束，等待HLTV完整统计。`);
          continue;
        }
        const stats = await dataSource.getStats(match.statsId);
        await messenger.send(formatResultMessages(match, stats));
        match.resultSent = true;
        match.resultSentAt = iso(now);
        logger.log(`已发送赛后统计：${match.id}`);
      }
    } catch (error) {
      logger.error(`检查比赛 ${original.id} 失败：${error.message}`);
    }
  }

  if (
    !state.lastHeartbeatAt ||
    now - Date.parse(state.lastHeartbeatAt) >= HEARTBEAT_MS
  ) {
    state.lastHeartbeatAt = iso(now);
  }
  pruneMatches(state, now);
  return state;
}

module.exports = {
  normalizeState,
  runMonitor,
  shouldInspect,
  shouldRefresh,
};
