const chartDom = document.getElementById("usage-chart");
const latestBalanceEl = document.getElementById("latest-balance");
const todayUsageEl = document.getElementById("today-usage");
const lastSyncEl = document.getElementById("last-sync");
const statusTextEl = document.getElementById("status-text");
const rangeHoursEl = document.getElementById("range-hours");
const intervalMinutesEl = document.getElementById("interval-minutes");
const applyBtnEl = document.getElementById("apply-btn");
const exportChartLinkEl = document.getElementById("export-chart-link");

const chart = echarts.init(chartDom);

const state = {
  rangeHours: Number(rangeHoursEl.value) || 72,
  intervalMinutes: Number(intervalMinutesEl.value) || 30,
  minIntervalMinutes: 30,
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

function updateExportLink() {
  const query = new URLSearchParams({
    rangeHours: String(state.rangeHours),
    intervalMinutes: String(state.intervalMinutes),
  });
  exportChartLinkEl.href = `/api/export-chart.csv?${query.toString()}`;
}

function renderChart(points) {
  const labels = points.map((item) => item.label);
  const consumptionValues = points.map((item) => item.consumption);
  const balanceValues = points.map((item) => item.balance);

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
        },
      ],
    },
    true,
  );
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function loadUiConfig() {
  const config = await fetchJson("/api/ui-config");
  state.minIntervalMinutes = Number(config.minIntervalMinutes) || 30;
  state.intervalMinutes = clampInterval(Number(config.defaultIntervalMinutes) || state.intervalMinutes);
  intervalMinutesEl.min = String(state.minIntervalMinutes);
  intervalMinutesEl.step = String(state.minIntervalMinutes);
  intervalMinutesEl.value = String(state.intervalMinutes);
}

function readControls() {
  state.rangeHours = Number(rangeHoursEl.value) || 72;
  state.intervalMinutes = clampInterval(Number(intervalMinutesEl.value));
  intervalMinutesEl.value = String(state.intervalMinutes);
}

async function refresh() {
  try {
    readControls();
    updateExportLink();

    const query = new URLSearchParams({
      rangeHours: String(state.rangeHours),
      intervalMinutes: String(state.intervalMinutes),
    });

    const [status, chartData] = await Promise.all([fetchJson("/api/status"), fetchJson(`/api/chart?${query.toString()}`)]);

    state.minIntervalMinutes = Number(chartData.minIntervalMinutes) || state.minIntervalMinutes;
    state.intervalMinutes = clampInterval(Number(chartData.intervalMinutes) || state.intervalMinutes);
    intervalMinutesEl.min = String(state.minIntervalMinutes);
    intervalMinutesEl.step = String(state.minIntervalMinutes);
    intervalMinutesEl.value = String(state.intervalMinutes);
    updateExportLink();

    latestBalanceEl.textContent = status.latestBalance == null ? "--" : `${status.latestBalance} 元`;
    todayUsageEl.textContent = `${status.todayConsumption ?? 0} 元`;
    lastSyncEl.textContent = formatDateTime(status.lastSyncAt);
    setStatus(status.lastError ? `采集异常: ${status.lastError}` : "运行正常", Boolean(status.lastError));

    renderChart(chartData.points || []);
  } catch (error) {
    setStatus(`加载失败: ${error.message}`, true);
  }
}

applyBtnEl.addEventListener("click", () => {
  refresh();
});

window.addEventListener("resize", () => chart.resize());

await loadUiConfig();
await refresh();
setInterval(refresh, 60 * 1000);
