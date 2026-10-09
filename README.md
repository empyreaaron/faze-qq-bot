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

计划每5分钟运行一次，但GitHub可能延迟数小时。要及时提醒，需要独立定时服务或常开服务器。

## 三、漏赛修复（2026-10-09）

- 每5分钟刷新赛程；每30分钟回查最近7天赛果，补发未发送的赛后消息，不补发过期开赛提醒。
- 以HLTV编号保留已发送标记。QQ发送失败保留待重试状态；其他场次失败不丢弃已成功发送的记录。
- 抓取失败、异常200网页和残缺比赛页明确报错。保存状态步骤在监控步骤失败后仍执行。
- dry_run只预览，不持久化发送标记或覆盖真实状态。
- 延期比赛会重新检查。BO3、BO5和加时按确认结束的地图判定。
- 每轮最多检查4场，优先进行中的比赛，其他比赛按上次检查时间轮转。

### 当前验收状态与需要的配置

实测匿名HLTV返回403，Jina的HTTP/HTTPS读取均返回Cloudflare页面，浏览器模式返回401并要求API key。**认证数据通道尚未实测成功。单元测试通过不代表抓取恢复。**

1. 在 [Jina Reader](https://jina.ai/reader/) 获取API key，在仓库 Settings → Secrets and variables → Actions 添加 Repository secret，名称为 `JINA_API_KEY`。不要把密钥放进代码或聊天。
2. 更新代码后手动运行工作流，勾选 `dry_run`。确认赛程和近期赛果补查成功，能读取比赛和双方统计。
3. 预览通过后再取消勾选运行，发送待补赛果。若仍被拦，需要更换可用数据通道，本项目不承诺仅配置key就一定能访问HLTV。
4. 配置key后启用浏览器读取，并禁用缓存。不会自动启用代理。
5. 仅当你选择使用Jina的代理功能时，自行设置仓库变量 `JINA_PROXY=auto` 或指定地区；配额和费用以你的Jina账户为准。

### 稳定调度接入

工作流新增 `repository_dispatch` 类型 `monitor-tick`，可由独立定时服务调用GitHub repository dispatch API。需要在该服务账户配置定时器与仅限本仓库的token；本次没有创建外部定时器。

若已有常开服务器，可以设置好环境变量后运行：

```bash
npm ci
npm run watch
```

每5分钟开始一轮，上一轮结束后才启动下一轮；失败保留队列并重试。需要服务器持续在线、进程管理器负责重启，以及可用的数据通道。电脑关机后应由服务器继续运行。

不要同时在GitHub和另一台服务器生产发送，两边不共享状态，会产生重复消息。`data/watch.lock` 拒绝同目录的第二个watch进程；异常关机后确认旧进程已停止，再删除残留锁。

## 四、限制

- GitHub定时任务可能延迟或被丢弃。本仓库已出现数小时间隔，改cron不能消除这个限制。
- HLTV没有公开API，且其条款禁止自动抓取。项目不会绕过Cloudflare验证；如果HLTV拦截GitHub共享IP，本次任务会失败并等待下个周期。
- HLTV改版可能需要更新解析器。补查只覆盖最近7天、首个赛果页面；超过窗口的旧漏赛不会自动补发。
- QQ已接收消息却在保存状态前被杀死时，下次可能重发，本实现不承诺严格的仅发送一次。

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
