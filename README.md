# VoltEye

VoltEye 是一个可部署在服务器上的公寓电费监控服务：后端定时登录唐巢接口采集电费余额，前端展示图表，支持导出表格。

## 主要功能

- 定时采集电表余额（后端调用 `api.tcnest.cn`）
- 图表支持柱状图 + 折线图
  - 柱状图：区间电费消耗
  - 折线图：电费余额走势
- 可调显示区间（近 6 小时 / 12 小时 / 1 天 / 2 天 / 3 天 / 7 天）
- 可调显示间隔（分钟），最小值自动受系统采集间隔约束
- 导出表格
  - 原始记录导出：`/api/export.csv`
  - 当前图表导出：`/api/export-chart.csv`
- 低余额阈值告警（Webhook，可选）
- 手动采集接口（`/api/sync`，`x-api-key` 鉴权）

## 安全设计

- 账号和密码只存在服务器 `.env`，不会返回前端
- 前端只访问本服务 API，不直接访问唐巢登录接口
- `SYNC_API_KEY` 保护手动采集接口
- 仓库忽略 `.env*`（保留 `.env.example`）和运行数据文件

## 环境变量

参考 [`.env.example`](E:/Privy/VoltEye/.env.example)：

- `HOST_PORT`：Docker 对外端口
- `PORT`：容器内监听端口（默认 3000）
- `SITE_MOBILE`：唐巢登录手机号（必填）
- `SITE_PASSWORD`：唐巢登录密码（必填）
- `POLL_INTERVAL_MINUTES`：采集间隔，默认 30
- `LOW_BALANCE_THRESHOLD`：低余额阈值，默认 50
- `CONTRACT_ID`：可选，指定合同 ID
- `SMART_KEY`：可选，指定电表 key
- `ALERT_WEBHOOK_URL`：可选，余额告警 webhook
- `SYNC_API_KEY`：手动采集接口鉴权

## 本地运行

```bash
npm install
cp .env.example .env
# 编辑 .env
npm start
```

打开 `http://localhost:3000`。

## Linux 服务器首次部署

```bash
bash scripts/deploy.sh
```

脚本会交互输入账号、密码、阈值等信息，并自动探测空闲端口写入 `HOST_PORT`，最后启动 Docker 服务。

## Linux 服务器更新（不影响现有数据）

```bash
bash scripts/update.sh
```

更新脚本特性：

- 不执行 `docker compose down -v`
- 不删除 `./data`
- 仅重建并重启 `volteye` 服务容器
- 会备份当前 `.env` 到 `.tmp/env-backup-*.env`

## Windows 本地测试

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-local.ps1
```

测试脚本特性：

- 手机号/密码只在当前 PowerShell 进程内使用，不写入仓库
- 数据写入 `%TEMP%` 临时目录，退出后自动清理
- 自动探测本机空闲端口，避免影响现有服务

## API

- `GET /api/health`：健康检查
- `GET /api/status`：当前余额和运行状态
- `GET /api/ui-config`：前端图表配置（最小间隔等）
- `GET /api/chart?rangeHours=72&intervalMinutes=30`：图表数据（柱状+折线）
- `GET /api/chart-daily?days=30`：按天聚合数据
- `GET /api/history?limit=300`：原始采集记录
- `GET /api/export.csv`：导出原始记录表格
- `GET /api/export-chart.csv?rangeHours=72&intervalMinutes=30`：导出当前图表表格
- `POST /api/sync`：手动触发采集（Header: `x-api-key`）

## 说明

- 余额采集依赖字段 `eleSmartMoney`。
- 消耗按相邻采样点余额下降量统计，充值导致的余额上升不会计入消耗。
