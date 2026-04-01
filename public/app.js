const chartDom = document.getElementById("usage-chart");
const latestBalanceEl = document.getElementById("latest-balance");
const todayUsageEl = document.getElementById("today-usage");
const predictedDaysEl = document.getElementById("predicted-days");
const lastSyncEl = document.getElementById("last-sync");
const statusTextEl = document.getElementById("status-text");
const rangeTextEl = document.getElementById("range-text");
const granularityTextEl = document.getElementById("granularity-text");
const intervalTextEl = document.getElementById("interval-text");
const bucketTextEl = document.getElementById("bucket-text");
const anomalyListEl = document.getElementById("anomaly-list");

const rangeHoursEl = document.getElementById("range-hours");
const granularityEl = document.getElementById("granularity");
const startTimeEl = document.getElementById("start-time");
const endTimeEl = document.getElementById("end-time");
const intervalMinutesEl = document.getElementById("interval-minutes");
const intervalControlEl = document.getElementById("interval-control");
const applyBtnEl = document.getElementById("apply-btn");
const clearTimeBtnEl = document.getElementById("clear-time-btn");
const exportChartLinkEl = document.getElementById("export-chart-link");

const chart = echarts.init(chartDom);

const GRANULARITY_LABEL_MAP = {
  auto: "自动",
  hourly: "按小时",
  daily: "按天",
};

const state = {
  rangeHours: Number(rangeHoursEl.value) || 72,
  granularity: granularityEl.value || "auto",
  intervalMinutes: Number(intervalMinutesEl.value) || 30,
  minIntervalMinutes: 30,
  startIso: "",
  endIso: "",
};

function formatDateTime(value) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDateTimeInputFromIso(iso) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function parseInputToIso(inputValue) {
  if (!inputValue) {
    return "";
  }
  const date = new Date(inputValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function formatAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "--";
  }
  return `${num.toFixed(2)} 元`;
}

function formatDays(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return "--";
  }
  return `${num.toFixed(2)} 天`;
}

function setStatus(message, isError = false) {
  statusTextEl.textContent = message;
  statusTextEl.classList.toggle("error", Boolean(isError));
}

function clampInterval(value) {
  if (!Number.isFinite(value)) {
    return state.minIntervalMinutes;
  }
  return Math.max(state.minIntervalMinutes, Math.floor(value));
}

function hasCustomWindow() {
  return Boolean(state.startIso && state.endIso);
}

function syncIntervalInputState() {
  const disabled = state.granularity === "daily";
  intervalMinutesEl.disabled = disabled;
  intervalControlEl.classList.toggle("disabled", disabled);
}

function updateExportLink() {
  const query = new URLSearchParams({
    rangeHours: String(state.rangeHours),
    granularity: state.granularity,
    intervalMinutes: String(state.intervalMinutes),
  });
  if (hasCustomWindow()) {
    query.set("start", state.startIso);
    query.set("end", state.endIso);
  }
  exportChartLinkEl.href = `/api/export-chart.csv?${query.toString()}`;
}

function updateMetaText(chartData) {
  if (chartData.mode === "custom") {
    rangeTextEl.textContent = `当前：${formatDateTime(chartData.start)} 到 ${formatDateTime(chartData.end)}`;
  } else {
    rangeTextEl.textContent = `当前：近 ${chartData.rangeHours} 小时`;
  }

  granularityTextEl.textContent = `粒度：${GRANULARITY_LABEL_MAP[chartData.granularity] || chartData.granularity}`;

  if (chartData.granularity === "daily") {
    intervalTextEl.textContent = "间隔：按天聚合";
  } else {
    intervalTextEl.textContent = `间隔：${chartData.intervalMinutes} 分钟`;
  }

  bucketTextEl.textContent = `点数：${chartData.bucketCount}`;
}

function pickBalanceForMark(balanceValues, index) {
  const direct = Number(balanceValues[index]);
  if (Number.isFinite(direct)) {
    return direct;
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const value = Number(balanceValues[i]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  for (let i = index + 1; i < balanceValues.length; i += 1) {
    const value = Number(balanceValues[i]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function buildAnomalyMarks(points, consumptionValues, balanceValues, anomalies) {
  const spikeMarks = [];
  const offlineMarks = [];

  for (const item of anomalies) {
    const idx = Number(item.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= points.length) {
      continue;
    }

    if (item.type === "spike") {
      spikeMarks.push({
        name: "异常消耗",
        xAxis: idx,
        yAxis: Number(consumptionValues[idx]) || 0,
        value: "突增",
      });
      continue;
    }

    if (item.type === "offline") {
      offlineMarks.push({
        name: "采集掉线",
        xAxis: idx,
        yAxis: pickBalanceForMark(balanceValues, idx),
        value: "掉线",
      });
    }
  }

  return { spikeMarks, offlineMarks };
}

function renderChart(points, anomalies) {
  const labels = points.map((item) => item.label);
  const consumptionValues = points.map((item) => item.consumption);
  const balanceValues = points.map((item) => item.balance);
  const { spikeMarks, offlineMarks } = buildAnomalyMarks(points, consumptionValues, balanceValues, anomalies);

  chart.setOption(
    {
      animationDuration: 350,
      legend: {
        top: 4,
        data: ["电费消耗", "电费余额"],
      },
      grid: {
        left: 20,
        right: 20,
        top: 60,
        bottom: 25,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
      },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", height: 16, bottom: 2, start: 0, end: 100 },
      ],
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "#9ca8b8" } },
      },
      yAxis: [
        {
          type: "value",
          name: "消耗(元)",
          axisLine: { lineStyle: { color: "#9ca8b8" } },
          splitLine: { lineStyle: { color: "#eef1f5" } },
        },
        {
          type: "value",
          name: "余额(元)",
          axisLine: { lineStyle: { color: "#9ca8b8" } },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "电费消耗",
          type: "bar",
          yAxisIndex: 0,
          data: consumptionValues,
          barMaxWidth: 18,
          itemStyle: {
            color: "#2f7b6d",
            borderRadius: [4, 4, 0, 0],
          },
          markPoint:
            spikeMarks.length > 0
              ? {
                  symbol: "pin",
                  symbolSize: 36,
                  itemStyle: { color: "#d64f4f" },
                  label: { color: "#fff", fontSize: 10 },
                  data: spikeMarks,
                }
              : undefined,
        },
        {
          name: "电费余额",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          connectNulls: true,
          symbolSize: 5,
          itemStyle: {
            color: "#f08a24",
          },
          lineStyle: {
            width: 2,
          },
          data: balanceValues,
          markPoint:
            offlineMarks.length > 0
              ? {
                  symbol: "triangle",
                  symbolSize: 16,
                  symbolRotate: 180,
                  itemStyle: { color: "#5b7095" },
                  label: {
                    show: true,
                    formatter: "离线",
                    color: "#5b7095",
                    fontSize: 10,
                    offset: [0, -16],
                  },
                  data: offlineMarks,
                }
              : undefined,
        },
      ],
    },
    true,
  );
}

function renderAnomalies(anomalies) {
  anomalyListEl.textContent = "";
  if (!Array.isArray(anomalies) || anomalies.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "暂无异常";
    anomalyListEl.appendChild(empty);
    return;
  }

  const latestFirst = [...anomalies].slice(-12).reverse();
  for (const item of latestFirst) {
    const li = document.createElement("li");
    li.className = `anomaly-item ${item.type || ""}`;

    const title = document.createElement("span");
    title.className = "anomaly-title";
    title.textContent = item.type === "spike" ? "异常消耗" : "采集掉线";

    const detail = document.createElement("span");
    detail.className = "anomaly-detail";
    detail.textContent = `${formatDateTime(item.ts)} · ${item.message || "--"}`;

    li.appendChild(title);
    li.appendChild(detail);
    anomalyListEl.appendChild(li);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    let message = `${url} -> ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }
  return response.json();
}

async function loadUiConfig() {
  const config = await fetchJson("/api/ui-config");
  state.minIntervalMinutes = Number(config.minIntervalMinutes) || 30;
  state.intervalMinutes = clampInterval(Number(config.defaultIntervalMinutes) || state.intervalMinutes);
  state.granularity = config.defaultGranularity || state.granularity;

  granularityEl.value = state.granularity;
  intervalMinutesEl.min = String(state.minIntervalMinutes);
  intervalMinutesEl.step = String(state.minIntervalMinutes);
  intervalMinutesEl.value = String(state.intervalMinutes);
}

function readControls() {
  state.rangeHours = Number(rangeHoursEl.value) || 72;
  state.granularity = granularityEl.value || "auto";
  state.intervalMinutes = clampInterval(Number(intervalMinutesEl.value));
  intervalMinutesEl.value = String(state.intervalMinutes);
  state.startIso = parseInputToIso(startTimeEl.value);
  state.endIso = parseInputToIso(endTimeEl.value);
  syncIntervalInputState();
}

function validateControls() {
  if ((state.startIso && !state.endIso) || (!state.startIso && state.endIso)) {
    throw new Error("开始时间和结束时间需要同时设置");
  }
  if (state.startIso && state.endIso) {
    const start = new Date(state.startIso).getTime();
    const end = new Date(state.endIso).getTime();
    if (!(end > start)) {
      throw new Error("结束时间必须晚于开始时间");
    }
  }
}

function updatePredictedInfo(status) {
  predictedDaysEl.textContent = formatDays(status.predictedRemainingDays);
  if (status.predictedDepletionAt) {
    predictedDaysEl.title = `预计耗尽时间：${formatDateTime(status.predictedDepletionAt)}`;
  } else {
    predictedDaysEl.removeAttribute("title");
  }
}

async function refresh() {
  try {
    readControls();
    validateControls();
    updateExportLink();

    const query = new URLSearchParams({
      rangeHours: String(state.rangeHours),
      granularity: state.granularity,
      intervalMinutes: String(state.intervalMinutes),
    });
    if (hasCustomWindow()) {
      query.set("start", state.startIso);
      query.set("end", state.endIso);
    }

    const [status, chartData] = await Promise.all([fetchJson("/api/status"), fetchJson(`/api/chart?${query.toString()}`)]);

    state.minIntervalMinutes = Number(chartData.minIntervalMinutes) || state.minIntervalMinutes;
    state.intervalMinutes = clampInterval(Number(chartData.intervalMinutes) || state.intervalMinutes);
    intervalMinutesEl.min = String(state.minIntervalMinutes);
    intervalMinutesEl.step = String(state.minIntervalMinutes);
    intervalMinutesEl.value = String(state.intervalMinutes);

    if (chartData.mode === "custom") {
      state.startIso = chartData.start;
      state.endIso = chartData.end;
      startTimeEl.value = formatDateTimeInputFromIso(chartData.start);
      endTimeEl.value = formatDateTimeInputFromIso(chartData.end);
    }

    updateExportLink();
    updateMetaText(chartData);

    latestBalanceEl.textContent = formatAmount(status.latestBalance);
    todayUsageEl.textContent = formatAmount(status.todayConsumption ?? 0);
    updatePredictedInfo(status);
    lastSyncEl.textContent = formatDateTime(status.lastSyncAt);
    setStatus(status.lastError ? `采集异常：${status.lastError}` : "运行正常", Boolean(status.lastError));

    renderAnomalies(chartData.anomalies || []);
    renderChart(chartData.points || [], chartData.anomalies || []);
  } catch (error) {
    setStatus(`加载失败：${error.message}`, true);
  }
}

applyBtnEl.addEventListener("click", () => {
  refresh();
});

granularityEl.addEventListener("change", () => {
  state.granularity = granularityEl.value || "auto";
  syncIntervalInputState();
  refresh();
});

clearTimeBtnEl.addEventListener("click", () => {
  state.startIso = "";
  state.endIso = "";
  startTimeEl.value = "";
  endTimeEl.value = "";
  refresh();
});

window.addEventListener("resize", () => chart.resize());

await loadUiConfig();
syncIntervalInputState();
await refresh();
setInterval(refresh, 60 * 1000);
