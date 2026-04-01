# VoltEye

VoltEye 是一个可部署在服务器上的公寓电费监控服务，自动登录唐巢公寓接口获取电表余额，保存历史记录，并在前端展示单图表（电费消耗趋势）。

## 主要功能

- 定时采集电表余额（后端调用 `api.tcnest.cn`）
- 单页单图表展示近 30 天电费消耗
- 低余额阈值告警（Webhook，可选）
- 手动采集接口（`/api/sync`，API Key 鉴权）
- 历史记录导出 CSV（`/api/export.csv`）

## 安全设计

- 账号和密码只存在服务器 `.env`，不会返回给前端
- 前端仅访问服务端 API，不直接访问唐巢登录接口
- `SYNC_API_KEY` 控制手动采集权限

## 环境变量

参考 `.env.example`：

- `SITE_MOBILE`：唐巢登录手机号（必填）
- `SITE_PASSWORD`：唐巢登录密码（必填）
- `HOST_PORT`：Docker 对外暴露端口（自动探测生成）
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

## 一键部署（Docker）

```bash
bash scripts/deploy.sh
```

脚本会交互式让你输入账号、密码、阈值等配置，自动探测空闲端口并写入 `HOST_PORT`，再生成 `.env` 和启动容器。

## Windows 本地测试

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-local.ps1
```

特点：

- 账号密码只在当前 PowerShell 进程内使用，不写入仓库文件
- 数据写入系统临时目录（`%TEMP%`），退出后自动清理
- 自动探测本机空闲端口，避免影响现有服务

## API

- `GET /api/health`：健康检查
- `GET /api/status`：当前余额与状态
- `GET /api/chart?days=30`：图表数据
- `GET /api/history?limit=300`：采集原始记录
- `GET /api/export.csv`：导出 CSV
- `POST /api/sync`：手动触发采集（Header: `x-api-key`）

## 说明

- 余额采集依赖唐巢接口字段 `eleSmartMoney`。
- 日消耗按相邻两次余额差值计算，仅统计“余额下降”部分（充值导致的余额上升不计入消耗）。
- 仓库默认忽略 `.env*`（保留 `.env.example`）和 `data/*`（保留 `data/.gitkeep`），避免凭据与运行数据被提交。
