"use strict";

const {
  formatResultMessages,
  formatScoreOnlyResultMessages,
  formatStartMessage,
} = require("./format");

const SCHEDULE_REFRESH_MS = 5 * 60 * 1000;
const RESULTS_REFRESH_MS = 30 * 60 * 1000;
const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const INSPECT_BEFORE_START_MS = 45 * 60 * 1000;
const KEEP_MATCH_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 30 * 24 * 60 * 60 * 1000;
// A finished match whose stats never materialise is re-checked on this cadence
// instead of burning a slot of the per-run budget on every single tick.
const OVER_RETRY_MS = 10 * 60 * 1000;
// ...and after this long we post the score alone rather than stay silent.
const STATS_WAIT_MS = 6 * 60 * 60 * 1000;
// Going blind used to be invisible: HLTV refused every read for three days and
// nothing said so. Warn the group instead of quietly skipping matches.
const BLIND_ALERT_AFTER_MS = 90 * 60 * 1000;
const BLIND_ALERT_REPEAT_MS = 6 * 60 * 60 * 1000;

function requireCompleteStats(stats) {
  for (const side of ["team1", "team2"]) {
    const players = stats?.playerStats?.[side];
    if (!Array.isArray(players) || players.length < 5) throw new Error("双方完整选手统计尚未生成");
    for (const player of players) {
      if (!player.player?.name || ["kills", "deaths", "ADR", "KAST", "rating3", "roundSwing"]
        .some((key) => !Number.isFinite(player[key]))) {
        throw new Error(`选手 ${player.player?.name || "未知"} 的统计不完整，保留待补发`);
      }
    }
  }
  return stats;
}

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
  if (record.status === "over") {
    if (!record.lastCheckedAt) return true;
    // Poll every tick while the result is still fresh — stats usually appear
    // within minutes and the group should not wait. Only a match that stayed
    // unresolved past the grace period backs off, so it cannot keep eating the
    // per-run budget forever.
    const overSince = Date.parse(record.overSince || "");
    if (!Number.isFinite(overSince) || now - overSince < STATS_WAIT_MS) {
      return true;
    }
    return now - Date.parse(record.lastCheckedAt) >= OVER_RETRY_MS;
  }
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

// Tell the group when HLTV has been unreadable for a while, and again when it
// recovers. Never let a failure here mask the monitoring result itself.
async function reportHealth({ state, messenger, now, logger }) {
  const lastRead = Date.parse(state.lastSuccessfulReadAt || "");
  const blindSince = Number.isFinite(lastRead) ? now - lastRead : null;
  const alerted = Date.parse(state.lastBlindAlertAt || "");

  if (blindSince !== null && blindSince < BLIND_ALERT_AFTER_MS) {
    if (Number.isFinite(alerted)) {
      state.lastBlindAlertAt = null;
      try {
        await messenger.send(["【监控恢复】已重新读到HLTV，比赛提醒继续。"]);
      } catch (error) {
        logger.error(`恢复通知发送失败：${error.message}`);
      }
    }
    return;
  }
  if (blindSince === null && !state.lastRunAt) return;
  if (Number.isFinite(alerted) && now - alerted < BLIND_ALERT_REPEAT_MS) return;

  const minutes =
    blindSince === null ? null : Math.round(blindSince / 60_000);
  try {
    await messenger.send([
      [
        "【监控异常】",
        minutes === null
          ? "还没有成功读到过HLTV。"
          : `已连续 ${minutes} 分钟无法读取HLTV，期间的比赛可能漏报。`,
        "恢复后会自动补发赛果。",
      ].join("\n"),
    ]);
    state.lastBlindAlertAt = iso(now);
    logger.log("已发送监控异常提醒。");
  } catch (error) {
    logger.error(`异常提醒发送失败：${error.message}`);
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
      state.lastSuccessfulReadAt = iso(now);
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
        state.lastSuccessfulReadAt = iso(now);
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
      state.lastSuccessfulReadAt = iso(now);
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
        match.overSince = match.overSince || iso(now);
        const waited = now - Date.parse(match.overSince);
        let stats = null;
        let statsError = null;
        if (match.embeddedStats || match.statsId) {
          stats = match.embeddedStats;
          try {
            requireCompleteStats(stats);
          } catch (error) {
            statsError = error;
            if (match.statsId) {
              stats = await dataSource.getStats(match.statsId);
              state.lastSuccessfulReadAt = iso(now);
              try {
                requireCompleteStats(stats);
                statsError = null;
              } catch (retryError) {
                statsError = retryError;
              }
            }
          }
        } else {
          statsError = new Error("HLTV还没有生成统计页");
        }

        if (statsError) {
          // Wait for HLTV to catch up, but not forever: a forfeited or
          // permanently broken match would otherwise never be reported at all.
          // The wait still counts as an error so the run never looks green
          // while a result is outstanding.
          if (
            waited < STATS_WAIT_MS ||
            !match.maps?.some((map) => map.result)
          ) {
            match.lastCheckedAt = iso(now);
            match.lastError = statsError.message;
            fail(`检查比赛 ${match.id} 失败：${statsError.message}`);
            continue;
          }
          await messenger.send(
            formatScoreOnlyResultMessages(match, statsError.message),
          );
          match.resultSent = true;
          match.resultSentAt = iso(now);
          match.resultDegraded = statsError.message;
          logger.log(`已发送仅比分赛果：${match.id}（${statsError.message}）`);
          await checkpoint(state);
          continue;
        }

        await messenger.send(formatResultMessages(match, stats));
        match.resultSent = true;
        match.resultSentAt = iso(now);
        logger.log(`已发送赛后统计：${match.id}`);
        await checkpoint(state);
      }
    } catch (error) {
      if (error.statePersistence) throw error;
      state.matches[id].lastCheckedAt = iso(now);
      state.matches[id].lastError = error.message;
      fail(`检查比赛 ${original.id} 失败：${error.message}`);
    }
  }

  await reportHealth({ state, messenger, now, logger });

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
  requireCompleteStats,
};
