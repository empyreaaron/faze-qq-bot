# FaZe QQ群比赛机器人

这个机器人在后台读取 FaZe 的 HLTV 赛程，但**不会提前在群里预告**。它只发送两类消息：

1. HLTV 将比赛标记为 `LIVE` 后发送开赛提醒。
2. 比赛结束且完整统计生成后，发送地图比分和双方所有选手的详细数据。

赛后字段包括 K-D、正负值、ADR、KAST、Rating 3.0、Round Swing、首杀、爆头、助攻/闪光助攻、多杀回合和残局胜利。

## 一、在电脑上取得群 OpenID

要求：安装 [Node.js 20或更高版本](https://nodejs.org/)。

解压项目后，在项目文件夹空白处按住 Shift 点击鼠标右键，选择“在终端中打开”，然后运行：

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

在 `.env` 中填写：

```text
QQ_APP_ID=你的AppID
QQ_APP_SECRET=你的AppSecret
QQ_GROUP_OPENID=
DRY_RUN=false
```

保存后运行：

```powershell
npm run bind
```

终端显示“已经连接QQ”后，到目标QQ群发送：

```text
@机器人 绑定
```

终端会输出：

```text
QQ_GROUP_OPENID=一串字符
```

机器人同时会向群里主动发送一条绑定成功消息。把这串 OpenID 填回 `.env`，可以再次测试：

```powershell
npm run test-message
```

`.env` 含有密钥，项目已经通过 `.gitignore` 排除它。不要截图、上传或发送这个文件。

## 二、上传到GitHub免费运行

1. 登录 GitHub，新建一个 **Public** 仓库。公开仓库的标准 GitHub Actions 不收费；代码中不包含密钥。
2. 将本项目解压后的全部文件和目录上传到仓库，包括 `.github`、`data`、`src`、`test`、`package.json` 和 `package-lock.json`。
3. 打开仓库 `Settings → Secrets and variables → Actions`。
4. 新建三个 Repository secrets：

| 名称              | 内容                          |
| ----------------- | ----------------------------- |
| `QQ_APP_ID`       | QQ机器人AppID                 |
| `QQ_APP_SECRET`   | QQ机器人AppSecret             |
| `QQ_GROUP_OPENID` | `npm run bind` 得到的群OpenID |

5. 打开 `Settings → Actions → General`，在 `Workflow permissions` 中选择 **Read and write permissions** 并保存。
6. 打开仓库的 `Actions` 页面，选择 `Monitor FaZe matches`，点击 `Run workflow` 手动运行一次。

之后 GitHub 大约每10分钟运行一次，不需要你的电脑保持开机。

## 三、运行逻辑

- 平时每4小时刷新一次 FaZe 赛程，仅保存在 `data/state.json`，不发群消息。
- 临近已知比赛时，每10分钟检查比赛状态。
- 只有 HLTV 页面显示 `LIVE` 才发开赛提醒；如果程序第一次发现时比赛已经结束，不补发开赛提醒。
- 完整赛后统计尚未生成时等待下一个周期。
- `data/state.json` 保存已发送状态，避免重复通知。
- 每30天写入一次心跳状态，避免公开仓库长期无活动后定时任务被GitHub自动停用。

## 四、限制

- GitHub 明确说明定时工作流可能延迟或偶尔被丢弃，因此开赛提醒通常会晚0–15分钟，无法保证精确到秒。
- HLTV没有公开API，且其条款禁止自动抓取。项目不会绕过Cloudflare验证；如果HLTV拦截GitHub共享IP，本次任务会失败并等待下个周期。
- HLTV改版后解析规则可能需要更新，因此不能保证永久有效。
- QQ群主动消息不能包含URL，因此消息只提供HLTV比赛编号。

相关文档：

- [QQ机器人鉴权](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html)
- [QQ发送群聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)
- [GitHub定时工作流](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows)
- [HLTV使用条款](https://www.hltv.org/terms)

## 五、本地开发

运行测试：

```powershell
npm test
```

只在终端预览消息、不发送到群：

```powershell
$env:DRY_RUN='true'
npm start
```
