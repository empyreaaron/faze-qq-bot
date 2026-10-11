"use strict";

// HLTV sits behind Cloudflare. A GitHub-hosted runner always has an Azure
// datacenter IP, and Cloudflare answers those with a 403 managed challenge no
// matter how well the TLS fingerprint is spoofed — that is why curl_cffi alone
// stopped working. So instead of one transport there is an ordered list of them,
// and the first one that returns a real HLTV page wins. The winner is remembered
// for the rest of the process so a single run does not re-probe dead transports.

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const execute = promisify(execFile);

const CHALLENGE_MARKERS =
  /Just a moment|cf-chl-|Attention Required|Enable JavaScript and cookies|cf_chl_opt/i;

// A transport that just failed is skipped for this long instead of being retried
// on every single page of the same run.
const STRATEGY_COOLDOWN_MS = 10 * 60 * 1000;

function isCloudflarePage(html) {
  return CHALLENGE_MARKERS.test(String(html || ""));
}

function flaresolverrEndpoint() {
  const configured = process.env.FLARESOLVERR_URL;
  if (!configured) return null;
  // Accept both "http://host:8191" and the full "http://host:8191/v1".
  return /\/v\d+$/.test(configured.replace(/\/$/, ""))
    ? configured.replace(/\/$/, "")
    : `${configured.replace(/\/$/, "")}/v1`;
}

// FlareSolverr drives a real undetected Chrome in its own container and hands
// back the solved HTML, which is what actually gets past a managed challenge.
async function fetchViaFlareSolverr(url) {
  const endpoint = flaresolverrEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url,
        maxTimeout: 120_000,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(text);
    if (payload.status !== "ok") {
      throw new Error(String(payload.message || "FlareSolverr未能解出页面"));
    }
    const solution = payload.solution || {};
    if (Number(solution.status) !== 200) {
      throw new Error(`目标站返回 HTTP ${solution.status}`);
    }
    return String(solution.response || "");
  } finally {
    clearTimeout(timer);
  }
}

// A real browser on a machine the user controls (laptop, VPS, self-hosted
// runner). Optional: only used when playwright happens to be installed.
async function fetchViaBrowser(url) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    throw new Error("未安装playwright");
  }
  const browser = await playwright.chromium.launch({
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "Europe/Copenhagen",
    });
    await context.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => undefined }),
    );
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Give the interstitial time to run its JS and redirect to the real page.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const html = await page.content();
      if (!isCloudflarePage(html)) return html;
      await page.waitForTimeout(2000);
    }
    throw new Error("浏览器等待超时，仍停在Cloudflare验证页");
  } finally {
    await browser.close().catch(() => {});
  }
}

// Browser-grade TLS from plain Python. Still the fastest path, and it works from
// a residential IP even though Cloudflare now refuses it from CI.
async function fetchViaCurlCffi(url) {
  const python =
    process.env.HLTV_PYTHON ||
    (process.platform === "win32" ? "python" : "python3");
  try {
    const result = await execute(
      python,
      [path.join(__dirname, "fetch-hltv.py"), url],
      {
        timeout: 50_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    return result.stdout;
  } catch (error) {
    throw new Error(
      error.code === "ENOENT"
        ? "未安装Python或HLTV_PYTHON路径不正确"
        : String(error.stderr || error.message)
            .trim()
            .slice(-300),
    );
  }
}

// Escape hatch: any relay the user owns (Cloudflare Worker, nginx, a box at
// home). HLTV_RELAY_URL may contain {url}; otherwise the target is appended.
async function fetchViaRelay(url) {
  const template = process.env.HLTV_RELAY_URL;
  const target = template.includes("{url}")
    ? template.replace("{url}", encodeURIComponent(url))
    : `${template}${encodeURIComponent(url)}`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
  if (process.env.HLTV_RELAY_TOKEN) {
    headers.Authorization = `Bearer ${process.env.HLTV_RELAY_TOKEN}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(target, { headers, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const STRATEGIES = [
  {
    name: "flaresolverr",
    available: () => Boolean(flaresolverrEndpoint()),
    run: fetchViaFlareSolverr,
  },
  {
    name: "browser",
    available: () => {
      if (process.env.HLTV_DISABLE_BROWSER === "true") return false;
      try {
        require.resolve("playwright");
        return true;
      } catch {
        return false;
      }
    },
    run: fetchViaBrowser,
  },
  {
    name: "curlcffi",
    available: () => process.env.HLTV_DISABLE_CURLCFFI !== "true",
    run: fetchViaCurlCffi,
  },
  {
    name: "relay",
    available: () => Boolean(process.env.HLTV_RELAY_URL),
    run: fetchViaRelay,
  },
];

function orderedStrategies() {
  const configured = String(process.env.HLTV_FETCH_ORDER || "")
    .split(/[,\s]+/)
    .filter(Boolean);
  if (!configured.length) return STRATEGIES;
  const byName = new Map(STRATEGIES.map((s) => [s.name, s]));
  const chosen = configured.map((name) => byName.get(name)).filter(Boolean);
  return chosen.length ? chosen : STRATEGIES;
}

class HltvFetcher {
  constructor({ logger = console, strategies = null } = {}) {
    this.logger = logger;
    this.strategies = strategies;
    this.preferred = null;
    this.cooldowns = new Map();
  }

  all() {
    return this.strategies || orderedStrategies();
  }

  describe() {
    const names = this.all()
      .filter((strategy) => strategy.available())
      .map((strategy) => strategy.name);
    return names.length ? names.join(" → ") : "无可用读取方式";
  }

  async fetch(url, { now = Date.now() } = {}) {
    const candidates = this.all().filter((strategy) => strategy.available());
    if (!candidates.length) {
      throw new Error(
        "没有可用的HLTV读取方式：请设置 FLARESOLVERR_URL、安装playwright，或配置 HLTV_RELAY_URL。",
      );
    }
    // Retry the transport that worked last time first.
    candidates.sort(
      (a, b) =>
        (b.name === this.preferred ? 1 : 0) - (a.name === this.preferred ? 1 : 0),
    );

    const errors = [];
    let skipped = 0;
    for (const strategy of candidates) {
      const cooldownUntil = this.cooldowns.get(strategy.name) || 0;
      // Only honour the cooldown while some other transport is still untried.
      if (cooldownUntil > now && skipped + errors.length < candidates.length - 1) {
        skipped += 1;
        continue;
      }
      try {
        const html = await strategy.run(url);
        if (!html) throw new Error("返回了空页面");
        if (isCloudflarePage(html)) throw new Error("仍是Cloudflare验证页");
        this.cooldowns.delete(strategy.name);
        if (this.preferred !== strategy.name) {
          this.logger.log(`HLTV读取方式：${strategy.name}`);
          this.preferred = strategy.name;
        }
        return html;
      } catch (error) {
        this.cooldowns.set(strategy.name, now + STRATEGY_COOLDOWN_MS);
        if (this.preferred === strategy.name) this.preferred = null;
        errors.push(`${strategy.name}: ${error.message}`);
      }
    }
    throw new Error(`HLTV读取失败 → ${errors.join("；")}`);
  }
}

module.exports = {
  HltvFetcher,
  isCloudflarePage,
  orderedStrategies,
};
