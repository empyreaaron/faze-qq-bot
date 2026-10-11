# FaZe QQ 比赛机器人 · 无 Jina 版（2026-10-11）

保留原版的开赛提醒、淘汰赛标题、北京时间、赛事与 BO 赛制，以及赛后总比分、地图比分和双方全部选手的 K-D / ADR / KAST / Rating 3.0 / Swing。赛后消息仍合并为一条，FaZe 数据优先显示。`@全体成员` 的表现与原版相同。

## 本次解决的问题

- 完全移除 Jina 请求、API key 和代理依赖。改用 `curl_cffi` 直接读取 HLTV，不需要注册数据服务或充值。固定 Python 依赖版本，Chrome 请求配置失败时尝试 Firefox 配置。
- 赛果页使用实测可用的队伍筛选 URL；日期范围在本地过滤，避免被拦截的组合查询。
- 启动一次云端任务后，每五分钟开始一轮检查，持续五小时，再通过 GitHub 自带 token 启动下一轮任务。小时级 cron 仅作为恢复入口，日常轮询不再等 cron 触发。
- 每五分钟更新赛程，每三十分钟补查最近七天的比赛。原有发送记录保留，已结束比赛只补发赛后消息，不补发过期的开赛提醒。
- 每次成功发送后立即写入状态并推送到仓库；保存失败就暂停发送，避免下一个云端任务因拿到旧记录而重复推送。
- 全部必需统计字段齐全才发赛果，缺数据就保留待重试，错误不会被当成成功。

## 在现有仓库替换

压缩包分成两个上传目录，避免 Windows 隐藏 `.github` 造成路径错误。

1. 打开仓库根目录，选择 **Add file → Upload files**。把 `01-upload-to-root` 里面的内容拖进去（包括 `src`、`test` 文件夹），提交。不要上传 `01-upload-to-root` 这一层文件夹。
2. 打开仓库里的 **`.github/workflows`** 目录，再选择 **Add file → Upload files**，拖入 `02-upload-to-workflows` 里面的 `monitor.yml` 和 `test.yml`，提交。这两个文件不要上传到仓库根目录。
3. 原有三个 QQ Secrets 继续使用，不需要重新绑定群。旧的 Jina Secrets 即使留着也不会被读取。
4. 在 **Settings → Actions → General → Workflow permissions** 选择 **Read and write permissions**。
5. 先到 **Actions → Monitor FaZe matches → Run workflow** 勾选 `dry_run`。这会只跑一轮、打印完整消息，不发送、不写入发送记录。此步确认你的 GitHub 运行节点也能读取 HLTV。
6. 预览成功后，再运行一次：取消 `dry_run`，`mode` 选 **continuous**。第一次会补发最近七天漏掉的赛果，随后持续监控。电脑可以关闭。

本包不包含 `data/state.json` 和 `.env`，不会重置已有的发送记录或密钥。所有目录按上述位置合并上传，不要删除原仓库的其他文件。

## 云端运行说明

- `continuous`：每五分钟检查，五小时后自动交接。任务长期显示黄色 **In progress** 属于正常工作；日志中应持续出现每轮结果。
- `once`：只检查一轮并结束，不自动接续。
- `dry_run`：无论 mode 如何，只预览一轮。
- 有比赛直播时发送开赛提醒；没有未来赛程时，赛程解析成功且 FaZe 列表为空是正常结果。
- GitHub 同一时间只允许一个生产任务发送。备用 cron 可能产生排队或被替换取消的任务；正在工作的生产任务不会因此被取消。
- 停用：先在仓库 Actions 变量中设置 `MONITOR_ENABLED=false`，再取消正在运行或排队的 Monitor 任务。恢复时移除该变量或改为 `true`，然后手动启动。
- 代码升级时，先取消旧的持续任务，再启动最新版，避免旧进程继续运行五小时。

使用 GitHub **公开仓库的标准 ubuntu-latest runner**；不要改成收费的大型 runner。工作流只使用仓库自动生成的 GITHUB_TOKEN，不要求额外 PAT、云服务器或付费服务。

## 实测与边界

2026-10-11 在当前测试环境直接抓取成功：赛程、队伍赛果、四场近期 FaZe 比赛。完整 dry-run 成功生成四条原格式赛后消息，包含双方共 40 条选手统计；没有发到 QQ，也没有修改你的生产状态。

GitHub 运行节点的网络出口与本测试环境不同，需以第 5 步的预览日志验收；本包并未声称已在你的仓库部署或完成 QQ 端到端发送。现有 GitHub 连接没有写入权限，因此提供可直接上传的替换包。

HLTV 将来仍可能调整访问规则或网页结构。失败会明确报错并重试，不会把残缺数据当成功。五分钟是任务正常运行时的轮询周期；GitHub任务交接仍可能排队，不构成分钟级时效保证。

补查范围为最近七天、队伍赛果首页（通常最多100场）；超过窗口的漏赛不会自动补发。QQ 已接收而确认响应丢失、或刚发送就被强制终止的极小窗口，仍可能导致重复，本程序不宣称严格恰好发送一次。

若日志提示“发送状态无法保存到GitHub”，程序会尝试停用工作流并取消排队任务。先修复仓库写入权限或 Git 冲突。该次任务会保存 `notification-state-运行编号` 备份；先恢复其中的 `state.json` 到 `data/state.json`，再启用工作流并重新启动，避免重复补发。如果 GitHub API 本身也故障，自动停用可能失败，此时应手动停用。

## 本地运行与测试

需要 Node.js 20+、Python 3.10+（工作流自动安装 Node 22、Python 3.12）。在仓库根目录：

```powershell
npm ci
python -m pip install -r requirements.txt
npm test
$env:DRY_RUN="true"
$env:HLTV_PYTHON="python"
npm start
```

已有常开电脑/服务器可通过 `npm run watch` 轮询；不要与 GitHub 同时生产发送。QQ 配置仍使用原有 `.env`。`HLTV_PYTHON` 可指定 Python 可执行文件的完整路径。

参考：
- https://github.com/lexiforest/curl_cffi
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
