function round2(num) {
  return Math.round(num * 100) / 100;
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

function buildDayKeys(days, timeZone) {
  const keys = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    keys.push(formatDay(date, timeZone));
  }
  return keys;
}

export function buildDailyConsumption(records, days, timeZone) {
  const dayKeys = buildDayKeys(days, timeZone);
  const daySet = new Set(dayKeys);
  const metrics = new Map();

  for (const key of dayKeys) {
    metrics.set(key, { day: key, consumption: 0, balance: null });
  }

  if (!Array.isArray(records) || records.length < 1) {
    return dayKeys.map((key) => metrics.get(key));
  }

  const sorted = [...records].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const record of sorted) {
    const key = formatDay(new Date(record.timestamp), timeZone);
    if (daySet.has(key)) {
      metrics.get(key).balance = round2(Number(record.balance));
    }
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevBalance = Number(prev.balance);
    const currBalance = Number(curr.balance);
    if (!Number.isFinite(prevBalance) || !Number.isFinite(currBalance)) {
      continue;
    }

    const delta = prevBalance - currBalance;
    const key = formatDay(new Date(curr.timestamp), timeZone);
    if (!daySet.has(key)) {
      continue;
    }
    if (delta > 0) {
      metrics.get(key).consumption = round2(metrics.get(key).consumption + delta);
    }
  }

  return dayKeys.map((key) => metrics.get(key));
}

export function buildStatusSummary(records, status, threshold, timeZone) {
  const latest = records.length ? records[records.length - 1] : null;
  const sevenDays = buildDailyConsumption(records, 7, timeZone);
  const today = sevenDays[sevenDays.length - 1];

  return {
    latestBalance: latest ? round2(Number(latest.balance)) : null,
    latestTimestamp: latest ? latest.timestamp : null,
    lowBalanceThreshold: threshold,
    lowBalance: latest ? Number(latest.balance) <= threshold : null,
    todayConsumption: today ? today.consumption : 0,
    sevenDayConsumption: round2(sevenDays.reduce((sum, item) => sum + item.consumption, 0)),
    lastSyncAt: status.lastSyncAt || null,
    lastError: status.lastError || null,
    lastErrorAt: status.lastErrorAt || null,
    lastAlertAt: status.lastAlertAt || null,
  };
}
