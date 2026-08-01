"use strict";

const TOKEN_ENDPOINTS = [
  "https://bots.qq.com/app/getAppAccessToken",
  "https://api.bot.qq.com/app/getAppAccessToken",
];
const API_BASES = ["https://api.bot.qq.com", "https://api.sgroup.qq.com"];

function required(value, name) {
  if (!value || !String(value).trim()) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return String(value).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getAppAccessToken(appId, appSecret) {
  const body = JSON.stringify({
    appId: required(appId, "QQ_APP_ID"),
    clientSecret: required(appSecret, "QQ_APP_SECRET"),
  });
  const errors = [];

  for (const endpoint of TOKEN_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text);
      if (!data.access_token) {
        throw new Error(`响应中没有 access_token: ${text.slice(0, 300)}`);
      }
      return data.access_token;
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }

  throw new Error(`获取QQ Access Token失败\n${errors.join("\n")}`);
}

async function qqApiRequest(path, accessToken, options = {}) {
  const errors = [];
  for (const base of API_BASES) {
    try {
      const response = await fetchWithTimeout(`${base}${path}`, {
        ...options,
        headers: {
          Authorization: `QQBot ${accessToken}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(
          `HTTP ${response.status}: ${text.slice(0, 500)}`,
        );
        error.status = response.status;
        throw error;
      }
      return text ? JSON.parse(text) : {};
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
      if (error.status && error.status < 500 && error.status !== 404) {
        break;
      }
    }
  }
  throw new Error(`QQ接口调用失败 ${path}\n${errors.join("\n")}`);
}

function splitText(text, maxLength = 1400) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const chunks = [];
  let current = "";

  for (const originalLine of lines) {
    let line = originalLine;
    while (line.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

class QQMessenger {
  constructor({ appId, appSecret, groupOpenId, dryRun = false }) {
    this.appId = required(appId, "QQ_APP_ID");
    this.appSecret = required(appSecret, "QQ_APP_SECRET");
    this.groupOpenId = required(groupOpenId, "QQ_GROUP_OPENID");
    this.dryRun = dryRun;
    this.cachedToken = null;
  }

  async token() {
    if (!this.cachedToken) {
      this.cachedToken = await getAppAccessToken(this.appId, this.appSecret);
    }
    return this.cachedToken;
  }

  async send(messages) {
    const chunks = messages.flatMap((message) => splitText(message));
    if (this.dryRun) {
      for (const chunk of chunks)
        console.log(`\n--- DRY RUN QQ消息 ---\n${chunk}`);
      return;
    }

    const token = await this.token();
    for (const content of chunks) {
      await qqApiRequest(
        `/v2/groups/${encodeURIComponent(this.groupOpenId)}/messages`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ msg_type: 0, content }),
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
}

async function getGatewayUrl(accessToken) {
  const result = await qqApiRequest("/gateway", accessToken, { method: "GET" });
  if (!result.url) throw new Error("QQ网关响应中没有WebSocket地址");
  return result.url;
}

module.exports = {
  QQMessenger,
  getAppAccessToken,
  getGatewayUrl,
  qqApiRequest,
  splitText,
};
