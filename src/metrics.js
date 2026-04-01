const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function round2(num) {
  return Math.round(num * 100) / 100;
}

function pad2(num) {
  return String(num).padStart(2, "0");
}

function dayKeyFromUtcMs(ms) {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function dayKeyToUtcMs(dayKey) {
  const [year, month, day] = dayKey.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

function formatDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      map[part.type] = part.value;
    }
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function formatMonthDayLabel(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type === "month" || part.type === "day") {
      map[part.type] = part.value;
    }
  }
  return `${map.month}-${map.day}`;
}

function buildDayKeys(days, timeZone) {
  const keys = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now - i * DAY_MS);
    keys.push(formatDay(date, timeZone));
  }
  return keys;
}

function buildDayKeysInWindow(startMs, endMs, timeZone) {
  const safeStart = Math.max(0, Math.floor(startMs));
  const safeEnd = Math.max(safeStart + 1, Math.floor(endMs));
  const startKey = formatDay(new Date(safeStart), timeZone);
  const endKey = formatDay(new Date(safeEnd - 1), timeZone);
  const startUtc = dayKeyToUtcMs(startKey);
  const endUtc = dayKeyToUtcMs(endKey);

  if (startUtc === null || endUtc === null || endUtc < startUtc) {
    return [];
  }

  const keys = [];
  for (let cursor = startUtc; cursor <= endUtc; cursor += DAY_MS) {
    keys.push(dayKeyFromUtcMs(cursor));
  }
  return keys;
}

function formatChartLabel(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute") {
      map[part.type] = part.value;
    }
  }
  return `${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }
  return records
    .map((item) => ({
      ...item,
      t: new Date(item.timestamp).getTime(),
      b: Number(item.balance),
    }))
    .filter((item) => Number.isFinite(item.t) && Number.isFinite(item.b))
    .sort((a, b) => a.t - b.t);
}

function findPointIndexByTime(points, targetMs) {
  if (!points.length) {
    return -1;
  }
  let index = 0;
  for (let i = 0; i < points.length; i += 1) {
    const currentMs = new Date(points[i].ts).getTime();
    if (!Number.isFinite(currentMs)) {
      continue;
    }
    if (currentMs <= targetMs) {
      index = i;
      continue;
    }
    break;
  }
  return index;
}

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function formatGapText(gapMinutes) {
  if (gapMinutes >= 60) {
    return `${round2(gapMinutes / 60)} 小时`;
  }
  return `${round2(gapMinutes)} 分钟`;
}

function detectSpikeAnomalies(points, granularity) {
  const positiveValues = points.map((item) => Number(item.consumption)).filter((value) => Number.isFinite(value) && value > 0);
  if (positiveValues.length < 4) {
    return [];
  }

  const mean = positiveValues.reduce((sum, value) => sum + value, 0) / positiveValues.length;
  const variance =
    positiveValues.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, positiveValues.length);
  const std = Math.sqrt(Math.max(0, variance));
  const median = percentile(positiveValues, 0.5);
  const hardFloor = granularity === "daily" ? 2 : 0.6;
  const threshold = Math.max(hardFloor, median * 3, mean + 2 * std);

  const anomalies = [];
  for (let i = 0; i < points.length; i += 1) {
    const value = Number(points[i].consumption);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (value < threshold) {
      continue;
    }
    anomalies.push({
      id: `spike-${i}`,
      type: "spike",
      severity: "high",
      index: i,
      ts: points[i].ts,
      label: points[i].label,
      consumption: round2(value),
      threshold: round2(threshold),
      message: `疑似异常消耗 ${round2(value)} 元（阈值 ${round2(threshold)} 元）`,
    });
  }

  return anomalies.slice(0, 30);
}

function detectOfflineAnomalies(records, points, startMs, endMs, expectedSampleMinutes, timeZone) {
  const sorted = normalizeRecords(records);
  if (!sorted.length || !points.length) {
    return [];
  }

  const expectedMs = Math.max(MINUTE_MS, Math.floor(expectedSampleMinutes * MINUTE_MS));
  const thresholdMs = expectedMs * 3;
  const anomalies = [];

  let beforeStart = null;
  let firstAfterStart = null;
  const inWindow = [];
  for (const item of sorted) {
    if (item.t < startMs) {
      beforeStart = item;
      continue;
    }
    if (!firstAfterStart) {
      firstAfterStart = item;
    }
    if (item.t > endMs) {
      break;
    }
    inWindow.push(item);
  }

  const pushGap = (gapStart, gapEnd) => {
    const start = Math.max(startMs, gapStart);
    const end = Math.min(endMs, gapEnd);
    if (!(end > start)) {
      return;
    }
    const gapMs = end - start;
    if (gapMs < thresholdMs) {
      return;
    }
    const gapMinutes = gapMs / MINUTE_MS;
    const index = findPointIndexByTime(points, start);
    anomalies.push({
      id: `offline-${start}-${end}`,
      type: "offline",
      severity: "medium",
      index: Math.max(0, index),
      ts: new Date(start).toISOString(),
      label: formatChartLabel(new Date(start), timeZone),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      gapMinutes: round2(gapMinutes),
      message: `采集掉线约 ${formatGapText(gapMinutes)}`,
    });
  };

  let prev = beforeStart;
  for (const current of inWindow) {
    if (prev) {
      pushGap(prev.t, current.t);
    }
    prev = current;
  }

  if (inWindow.length === 0) {
    if (beforeStart) {
      pushGap(beforeStart.t, endMs);
    } else if (firstAfterStart) {
      pushGap(startMs, Math.min(firstAfterStart.t, endMs));
    } else {
      pushGap(startMs, endMs);
    }
  } else {
    const first = inWindow[0];
    if (!beforeStart && first.t - startMs >= thresholdMs) {
      pushGap(startMs, first.t);
    }
    const last = inWindow[inWindow.length - 1];
    if (endMs - last.t >= thresholdMs) {
      pushGap(last.t, endMs);
    }
  }

  return anomalies.slice(0, 30);
}

export function buildChartAnomalies(
  records,
  points,
  {
    startMs,
    endMs,
    granularity,
    expectedSampleMinutes,
    timeZone,
  },
) {
  const spikes = detectSpikeAnomalies(points, granularity);
  const offline = detectOfflineAnomalies(records, points, startMs, endMs, expectedSampleMinutes, timeZone);
  return [...spikes, ...offline].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

export function buildIntervalSeries(records, startMs, endMs, intervalMinutes, timeZone) {
  const sorted = normalizeRecords(records);
  const safeStart = Math.max(0, Math.floor(startMs));
  const safeEnd = Math.max(safeStart + 1, Math.floor(endMs));
  const rangeMs = Math.max(1, safeEnd - safeStart);
  const intervalMs = Math.max(MINUTE_MS, Math.floor(intervalMinutes * MINUTE_MS));
  const bucketCount = Math.max(1, Math.ceil(rangeMs / intervalMs));

  const points = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const bucketStart = safeStart + i * intervalMs;
    points.push({
      ts: new Date(bucketStart).toISOString(),
      label: formatChartLabel(new Date(bucketStart), timeZone),
      consumption: 0,
      balance: null,
    });
  }

  if (!sorted.length) {
    return points;
  }

  let pointer = 0;
  let lastBalance = null;
  while (pointer < sorted.length && sorted[pointer].t < safeStart) {
    lastBalance = sorted[pointer].b;
    pointer += 1;
  }

  for (let i = 0; i < points.length; i += 1) {
    const bucketEnd = safeStart + (i + 1) * intervalMs;
    while (pointer < sorted.length && sorted[pointer].t <= bucketEnd) {
      lastBalance = sorted[pointer].b;
      pointer += 1;
    }
    points[i].balance = lastBalance === null ? null : round2(lastBalance);
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.t < safeStart || curr.t > safeEnd) {
      continue;
    }
    const delta = prev.b - curr.b;
    if (delta <= 0) {
      continue;
    }
    const index = Math.min(points.length - 1, Math.max(0, Math.floor((curr.t - safeStart) / intervalMs)));
    points[index].consumption = round2(points[index].consumption + delta);
  }

  return points;
}

export function buildDailySeries(records, startMs, endMs, timeZone) {
  const sorted = normalizeRecords(records);
  const dayKeys = buildDayKeysInWindow(startMs, endMs, timeZone);
  const byDay = new Map();

  for (const key of dayKeys) {
    byDay.set(key, {
      ts: `${key}T00:00:00.000Z`,
      day: key,
      label: formatMonthDayLabel(new Date(`${key}T00:00:00.000Z`), "UTC"),
      consumption: 0,
      balance: null,
    });
  }

  if (!dayKeys.length) {
    return [];
  }

  let carryBalance = null;
  for (const item of sorted) {
    if (item.t < startMs) {
      carryBalance = item.b;
      continue;
    }
    if (item.t > endMs) {
      break;
    }
    const key = formatDay(new Date(item.t), timeZone);
    const point = byDay.get(key);
    if (point) {
      point.balance = round2(item.b);
    }
  }

  for (const key of dayKeys) {
    const point = byDay.get(key);
    if (point.balance === null && carryBalance !== null) {
      point.balance = round2(carryBalance);
    } else if (point.balance !== null) {
      carryBalance = point.balance;
    }
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.t < startMs || curr.t > endMs) {
      continue;
    }
    const delta = prev.b - curr.b;
    if (delta <= 0) {
      continue;
    }
    const key = formatDay(new Date(curr.t), timeZone);
    const point = byDay.get(key);
    if (point) {
      point.consumption = round2(point.consumption + delta);
    }
  }

  return dayKeys.map((key) => byDay.get(key));
}

export function buildDailyConsumption(records, days, timeZone) {
  const dayKeys = buildDayKeys(days, timeZone);
  const daySet = new Set(dayKeys);
  const metrics = new Map();

  for (const key of dayKeys) {
    metrics.set(key, { day: key, consumption: 0, balance: null });
  }

  const sorted = normalizeRecords(records);
  if (sorted.length < 1) {
    return dayKeys.map((key) => metrics.get(key));
  }

  for (const record of sorted) {
    const key = formatDay(new Date(record.t), timeZone);
    if (daySet.has(key)) {
      metrics.get(key).balance = round2(record.b);
    }
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const delta = prev.b - curr.b;
    if (delta <= 0) {
      continue;
    }
    const key = formatDay(new Date(curr.t), timeZone);
    if (!daySet.has(key)) {
      continue;
    }
    metrics.get(key).consumption = round2(metrics.get(key).consumption + delta);
  }

  return dayKeys.map((key) => metrics.get(key));
}

export function buildStatusSummary(records, status, threshold, timeZone) {
  const normalized = normalizeRecords(records);
  const latest = normalized.length ? normalized[normalized.length - 1] : null;
  const sevenDays = buildDailyConsumption(normalized, 7, timeZone);
  const today = sevenDays[sevenDays.length - 1];
  const total7d = sevenDays.reduce((sum, item) => sum + Number(item.consumption || 0), 0);
  const avgDailyConsumption7d = round2(total7d / Math.max(1, sevenDays.length));
  const latestBalance = latest ? round2(latest.b) : null;

  let predictedRemainingDays = null;
  let predictedDepletionAt = null;
  if (latestBalance !== null && avgDailyConsumption7d > 0) {
    predictedRemainingDays = round2(latestBalance / avgDailyConsumption7d);
    const baseMs = latest ? latest.t : Date.now();
    predictedDepletionAt = new Date(baseMs + predictedRemainingDays * DAY_MS).toISOString();
  }

  return {
    latestBalance,
    latestTimestamp: latest ? new Date(latest.t).toISOString() : null,
    lowBalanceThreshold: threshold,
    lowBalance: latest ? latest.b <= threshold : null,
    todayConsumption: today ? round2(today.consumption) : 0,
    sevenDayConsumption: round2(total7d),
    avgDailyConsumption7d,
    predictedRemainingDays,
    predictedDepletionAt,
    lastSyncAt: status.lastSyncAt || null,
    lastError: status.lastError || null,
    lastErrorAt: status.lastErrorAt || null,
    lastAlertAt: status.lastAlertAt || null,
  };
}
