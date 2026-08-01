"use strict";

require("dotenv").config();
const WebSocket = require("ws");
const { QQMessenger, getAppAccessToken, getGatewayUrl } = require("./qq");

const appId = process.env.QQ_APP_ID;
const appSecret = process.env.QQ_APP_SECRET;
const GROUP_AND_C2C_EVENT = 1 << 25;

async function main() {
  if (!appId || !appSecret) {
    throw new Error(
      "请先把 .env.example 复制为 .env，并填写 QQ_APP_ID、QQ_APP_SECRET",
    );
  }

  const accessToken = await getAppAccessToken(appId, appSecret);
  const gatewayUrl = await getGatewayUrl(accessToken);
  const ws = new WebSocket(gatewayUrl);
  let sequence = null;
  let heartbeatTimer = null;
  let captured = false;

  const timeout = setTimeout(
    () => {
      console.error(
        "等待超时。请确认机器人已经进群，然后重新运行 npm run bind。",
      );
      ws.close();
      process.exitCode = 1;
    },
    5 * 60 * 1000,
  );

  ws.on("message", async (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      if (typeof payload.s === "number") sequence = payload.s;

      if (payload.op === 10) {
        const interval = payload.d.heartbeat_interval;
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              token: `QQBot ${accessToken}`,
              intents: GROUP_AND_C2C_EVENT,
              shard: [0, 1],
              properties: {
                $os: process.platform,
                $browser: "faze-qq-match-bot",
                $device: "faze-qq-match-bot",
              },
            },
          }),
        );
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: sequence }));
          }
        }, interval);
        return;
      }

      if (payload.t === "READY") {
        console.log("已经连接QQ。现在请到目标群里发送：@机器人 绑定");
        return;
      }

      const groupOpenId = payload.d && payload.d.group_openid;
      if (!captured && groupOpenId) {
        captured = true;
        console.log("\n绑定成功。请复制下面整行，稍后存入GitHub Secret：");
        console.log(`QQ_GROUP_OPENID=${groupOpenId}`);

        try {
          const messenger = new QQMessenger({
            appId,
            appSecret,
            groupOpenId,
          });
          await messenger.send([
            "FaZe比赛机器人绑定成功。之后只会在比赛开始和赛后统计生成时发消息。",
          ]);
          console.log("群内主动消息测试成功。");
        } catch (error) {
          console.error(`已取得群OpenID，但主动消息测试失败：${error.message}`);
        }

        clearTimeout(timeout);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        ws.close(1000);
      }
    } catch (error) {
      console.error(`处理QQ事件失败：${error.message}`);
    }
  });

  ws.on("error", (error) => {
    clearTimeout(timeout);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.error(`QQ WebSocket错误：${error.message}`);
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
