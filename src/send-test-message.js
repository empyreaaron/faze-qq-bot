"use strict";

require("dotenv").config();
const { QQMessenger } = require("./qq");

async function main() {
  const messenger = new QQMessenger({
    appId: process.env.QQ_APP_ID,
    appSecret: process.env.QQ_APP_SECRET,
    groupOpenId: process.env.QQ_GROUP_OPENID,
  });
  await messenger.send([
    "FaZe比赛机器人测试成功。后台会提前获取赛程，但只在比赛实际开始和完整赛后统计生成时发消息。",
  ]);
  console.log("测试消息已发送。");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
