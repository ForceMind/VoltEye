import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name, fallback, options = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`Environment variable ${name} cannot be smaller than ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`Environment variable ${name} cannot be greater than ${options.max}`);
  }
  return value;
}

export function loadConfig() {
  const config = {
    port: numberFromEnv("PORT", 3000, { min: 1, max: 65535 }),
    timeZone: process.env.TZ || "Asia/Shanghai",
    siteApiBase: process.env.SITE_API_BASE || "https://api.tcnest.cn",
    siteMobile: required("SITE_MOBILE"),
    sitePassword: required("SITE_PASSWORD"),
    pollIntervalMs: numberFromEnv("POLL_INTERVAL_MINUTES", 30, { min: 1, max: 1440 }) * 60 * 1000,
    lowBalanceThreshold: numberFromEnv("LOW_BALANCE_THRESHOLD", 50, { min: 0 }),
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
    alertCooldownMs: numberFromEnv("ALERT_COOLDOWN_HOURS", 6, { min: 0 }) * 60 * 60 * 1000,
    contractId: process.env.CONTRACT_ID || "",
    smartKey: process.env.SMART_KEY || "",
    syncApiKey: process.env.SYNC_API_KEY || "",
    maxRecords: numberFromEnv("MAX_RECORDS", 10000, { min: 500 }),
    dataFile: path.resolve(process.cwd(), process.env.DATA_FILE || "./data/balance-history.json"),
  };

  return config;
}
