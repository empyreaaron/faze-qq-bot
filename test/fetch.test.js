"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HltvFetcher } = require("../src/fetch");
const { parseResultsHtml } = require("../src/hltv");

const logger = { log() {}, error() {} };
const page = '<div class="upcomingMatch">ok</div>';

function strategy(name, impl, available = true) {
  return { name, available: () => available, run: impl };
}

test("第一种读取方式被Cloudflare拦住时自动换下一种", async () => {
  const calls = [];
  const fetcher = new HltvFetcher({
    logger,
    strategies: [
      strategy("flaresolverr", async () => {
        calls.push("flaresolverr");
        throw new Error("HTTP 403");
      }),
      strategy("curlcffi", async () => {
        calls.push("curlcffi");
        return page;
      }),
    ],
  });
  assert.equal(await fetcher.fetch("https://www.hltv.org/matches"), page);
  assert.deepEqual(calls, ["flaresolverr", "curlcffi"]);
});

test("返回验证页等于失败，不会被当成正常页面", async () => {
  const fetcher = new HltvFetcher({
    logger,
    strategies: [
      strategy("curlcffi", async () => "<html><title>Just a moment...</title>"),
    ],
  });
  await assert.rejects(
    fetcher.fetch("https://www.hltv.org/matches"),
    /仍是Cloudflare验证页/,
  );
});

test("成功的读取方式会被优先复用，失败的进入冷却", async () => {
  const calls = [];
  const fetcher = new HltvFetcher({
    logger,
    strategies: [
      strategy("flaresolverr", async () => {
        calls.push("flaresolverr");
        throw new Error("down");
      }),
      strategy("curlcffi", async () => {
        calls.push("curlcffi");
        return page;
      }),
    ],
  });
  await fetcher.fetch("https://www.hltv.org/a");
  calls.length = 0;
  await fetcher.fetch("https://www.hltv.org/b");
  assert.deepEqual(calls, ["curlcffi"]);
});

test("没有任何可用读取方式时给出可操作的提示", async () => {
  const fetcher = new HltvFetcher({
    logger,
    strategies: [strategy("curlcffi", async () => page, false)],
  });
  await assert.rejects(
    fetcher.fetch("https://www.hltv.org/matches"),
    /FLARESOLVERR_URL/,
  );
});

test("赛果页个别行异常不再丢掉整页补查结果", () => {
  const now = Date.parse("2026-10-09T14:00:00Z");
  const html = `
    <div class="results-holder">
      <div class="result-con">
        <a href="/matches/1/-"></a>
        <div class="team">FaZe</div><div class="team">Vitality</div>
      </div>
      <div class="result-con" data-zonedgrouping-entry-unix="${now - 3600000}">
        <a href="/matches/2/-"></a>
        <div class="team">FaZe</div><div class="team">Spirit</div>
        <span class="event-name">BLAST</span><div class="map-text">bo3</div>
      </div>
    </div>`;
  const results = parseResultsHtml(html, { since: now - 86400000, now });
  assert.deepEqual(
    results.map((match) => match.id),
    [2],
  );
});

test("整页赛果都无法识别时仍然报错，不当成空列表", () => {
  const html = '<div class="results-holder"><div class="result-con"></div></div>';
  assert.throws(
    () => parseResultsHtml(html, { since: 0, now: Date.now() }),
    /整页都无法识别/,
  );
});
