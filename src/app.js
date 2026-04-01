import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import { buildDailyConsumption, buildIntervalSeries, buildStatusSummary } from "./metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

function parseDays(raw, fallback = 30) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(365, Math.max(7, Math.floor(value)));
}

function parseLimit(raw, fallback = 200) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(5000, Math.max(1, Math.floor(value)));
}

function parseRangeHours(raw, fallback = 72) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(24 * 30, Math.max(1, Math.floor(value)));
}

function parseIntervalMinutes(raw, fallback, minIntervalMinutes) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minIntervalMinutes, Math.floor(value));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell)).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

export function createApp({ store, poller, config, logger }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  const minIntervalMinutes = Math.max(1, Math.round(config.pollIntervalMs / 60_000));

  app.get("/api/health", (req, res) => {
    const status = store.getStatus();
    res.json({
      ok: true,
      lastSyncAt: status.lastSyncAt,
      lastError: status.lastError,
      running: poller.running,
      now: new Date().toISOString(),
    });
  });

  app.get("/api/status", (req, res) => {
    const records = store.getRecords();
    const status = store.getStatus();
    const meta = store.getState().meta;
    const summary = buildStatusSummary(records, status, config.lowBalanceThreshold, config.timeZone);

    res.json({
      ...summary,
      contractId: meta.contractId,
      meterKey: meta.meterKey,
      meterBrand: meta.meterBrand,
      sampleCount: records.length,
    });
  });

  app.get("/api/ui-config", (req, res) => {
    res.json({
      minIntervalMinutes,
      defaultIntervalMinutes: minIntervalMinutes,
      defaultRangeHours: 72,
      serverTime: new Date().toISOString(),
    });
  });

  app.get("/api/chart", (req, res) => {
    const rangeHours = parseRangeHours(req.query.rangeHours, 72);
    const intervalMinutes = parseIntervalMinutes(req.query.intervalMinutes, minIntervalMinutes, minIntervalMinutes);
    const records = store.getRecords();
    const points = buildIntervalSeries(records, rangeHours, intervalMinutes, config.timeZone);
    res.json({
      rangeHours,
      intervalMinutes,
      minIntervalMinutes,
      points,
      updatedAt: new Date().toISOString(),
    });
  });

  app.get("/api/chart-daily", (req, res) => {
    const days = parseDays(req.query.days, 30);
    const records = store.getRecords();
    const points = buildDailyConsumption(records, days, config.timeZone);
    res.json({
      days,
      points,
      updatedAt: new Date().toISOString(),
    });
  });

  app.get("/api/history", (req, res) => {
    const limit = parseLimit(req.query.limit, 300);
    const records = store.getRecords();
    const sliced = records.slice(-limit);
    res.json({
      count: sliced.length,
      items: sliced,
    });
  });

  app.get("/api/export.csv", (req, res) => {
    const records = store.getRecords();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="volteye-history.csv"');
    res.send(
      toCsv(
        ["timestamp", "balance", "contractId", "meterKey", "meterBrand"],
        records.map((row) => [row.timestamp, row.balance, row.contractId, row.meterKey, row.meterBrand]),
      ),
    );
  });

  app.get("/api/export-chart.csv", (req, res) => {
    const rangeHours = parseRangeHours(req.query.rangeHours, 72);
    const intervalMinutes = parseIntervalMinutes(req.query.intervalMinutes, minIntervalMinutes, minIntervalMinutes);
    const points = buildIntervalSeries(store.getRecords(), rangeHours, intervalMinutes, config.timeZone);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="volteye-chart.csv"');
    res.send(
      toCsv(
        ["timestamp", "label", "consumption", "balance"],
        points.map((row) => [row.ts, row.label, row.consumption, row.balance]),
      ),
    );
  });

  app.post("/api/sync", async (req, res) => {
    const clientKey = req.header("x-api-key") || "";
    if (config.syncApiKey && clientKey !== config.syncApiKey) {
      return res.status(401).json({ ok: false, error: "invalid_api_key" });
    }

    try {
      const snapshot = await poller.runOnce(true);
      return res.json({ ok: true, snapshot });
    } catch (error) {
      logger.warn(`Manual sync failed: ${error.message}`);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.use(express.static(publicDir, { extensions: ["html"] }));

  app.use((error, req, res, next) => {
    logger.error(`Unhandled error: ${error.message}`);
    res.status(500).json({
      ok: false,
      error: "internal_server_error",
    });
  });

  return app;
}
