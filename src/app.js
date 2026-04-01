import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import {
  buildChartAnomalies,
  buildDailyConsumption,
  buildDailySeries,
  buildIntervalSeries,
  buildStatusSummary,
} from "./metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const MAX_BUCKETS = 1500;
const MAX_RANGE_HOURS = 24 * 365;
const AUTO_DAILY_THRESHOLD_HOURS = 72;
const SUPPORTED_GRANULARITIES = new Set(["auto", "hourly", "daily"]);

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
  return Math.min(MAX_RANGE_HOURS, Math.max(1, Math.floor(value)));
}

function parseIntervalMinutes(raw, fallback, minIntervalMinutes) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minIntervalMinutes, Math.floor(value));
}

function parseTimestampMs(raw) {
  if (!raw) {
    return null;
  }
  const ms = new Date(String(raw)).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  return ms;
}

function parseGranularity(raw) {
  const value = String(raw || "auto").toLowerCase();
  if (SUPPORTED_GRANULARITIES.has(value)) {
    return value;
  }
  return "auto";
}

function resolveChartWindow(query, fallbackRangeHours) {
  const now = Date.now();
  const startMs = parseTimestampMs(query.start);
  const endMs = parseTimestampMs(query.end);

  if ((startMs === null) !== (endMs === null)) {
    throw new Error("start 和 end 必须同时提供");
  }

  if (startMs !== null && endMs !== null) {
    if (endMs <= startMs) {
      throw new Error("end 必须晚于 start");
    }

    const cappedEnd = Math.min(endMs, now);
    const cappedStart = Math.min(startMs, cappedEnd - 1);
    const maxRangeMs = MAX_RANGE_HOURS * 60 * 60 * 1000;
    if (cappedEnd - cappedStart > maxRangeMs) {
      throw new Error(`时间范围不能超过 ${MAX_RANGE_HOURS} 小时`);
    }

    return {
      startMs: cappedStart,
      endMs: cappedEnd,
      mode: "custom",
    };
  }

  const rangeMs = Math.max(1, Math.floor(fallbackRangeHours * 60 * 60 * 1000));
  return {
    startMs: now - rangeMs,
    endMs: now,
    mode: "preset",
  };
}

function resolveGranularity(requestedGranularity, startMs, endMs) {
  if (requestedGranularity === "hourly" || requestedGranularity === "daily") {
    return requestedGranularity;
  }
  const windowHours = Math.max(1, Math.ceil((endMs - startMs) / (60 * 60 * 1000)));
  return windowHours > AUTO_DAILY_THRESHOLD_HOURS ? "daily" : "hourly";
}

function pickEffectiveIntervalMinutes(requestedIntervalMinutes, minIntervalMinutes, startMs, endMs) {
  const windowMinutes = Math.max(1, Math.ceil((endMs - startMs) / 60_000));
  const adaptiveMin = Math.ceil(windowMinutes / MAX_BUCKETS);
  return Math.max(minIntervalMinutes, requestedIntervalMinutes, adaptiveMin);
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

function resolveChartData({ query, records, timeZone, minIntervalMinutes }) {
  const rangeHours = parseRangeHours(query.rangeHours, 72);
  const window = resolveChartWindow(query, rangeHours);
  const requestedGranularity = parseGranularity(query.granularity);
  const granularity = resolveGranularity(requestedGranularity, window.startMs, window.endMs);
  const requestedIntervalMinutes = parseIntervalMinutes(
    query.intervalMinutes,
    minIntervalMinutes,
    minIntervalMinutes,
  );

  let intervalMinutes = requestedIntervalMinutes;
  let points = [];

  if (granularity === "daily") {
    intervalMinutes = 24 * 60;
    points = buildDailySeries(records, window.startMs, window.endMs, timeZone);
  } else {
    intervalMinutes = pickEffectiveIntervalMinutes(
      requestedIntervalMinutes,
      minIntervalMinutes,
      window.startMs,
      window.endMs,
    );
    points = buildIntervalSeries(records, window.startMs, window.endMs, intervalMinutes, timeZone);
  }

  const anomalies = buildChartAnomalies(records, points, {
    startMs: window.startMs,
    endMs: window.endMs,
    granularity,
    expectedSampleMinutes: minIntervalMinutes,
    timeZone,
  });

  return {
    mode: window.mode,
    rangeHours,
    startMs: window.startMs,
    endMs: window.endMs,
    requestedGranularity,
    granularity,
    requestedIntervalMinutes,
    intervalMinutes,
    bucketCount: points.length,
    minIntervalMinutes,
    points,
    anomalies,
  };
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
      maxRangeHours: MAX_RANGE_HOURS,
      maxBuckets: MAX_BUCKETS,
      defaultGranularity: "auto",
      autoDailyThresholdHours: AUTO_DAILY_THRESHOLD_HOURS,
      serverTime: new Date().toISOString(),
    });
  });

  app.get("/api/chart", (req, res) => {
    try {
      const records = store.getRecords();
      const chart = resolveChartData({
        query: req.query,
        records,
        timeZone: config.timeZone,
        minIntervalMinutes,
      });

      res.json({
        mode: chart.mode,
        rangeHours: chart.rangeHours,
        granularity: chart.granularity,
        requestedGranularity: chart.requestedGranularity,
        intervalMinutes: chart.intervalMinutes,
        requestedIntervalMinutes: chart.requestedIntervalMinutes,
        minIntervalMinutes: chart.minIntervalMinutes,
        bucketCount: chart.bucketCount,
        start: new Date(chart.startMs).toISOString(),
        end: new Date(chart.endMs).toISOString(),
        points: chart.points,
        anomalies: chart.anomalies,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
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
    try {
      const records = store.getRecords();
      const chart = resolveChartData({
        query: req.query,
        records,
        timeZone: config.timeZone,
        minIntervalMinutes,
      });

      const anomalyByIndex = new Map();
      for (const item of chart.anomalies) {
        const index = Number(item.index);
        if (!Number.isInteger(index) || index < 0 || index >= chart.points.length) {
          continue;
        }
        const list = anomalyByIndex.get(index) || [];
        list.push(item.message);
        anomalyByIndex.set(index, list);
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="volteye-chart.csv"');
      res.send(
        toCsv(
          ["timestamp", "label", "granularity", "consumption", "balance", "anomaly"],
          chart.points.map((row, index) => [
            row.ts,
            row.label,
            chart.granularity,
            row.consumption,
            row.balance,
            (anomalyByIndex.get(index) || []).join(" | "),
          ]),
        ),
      );
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
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
