const chartDom = document.getElementById("usage-chart");
const latestBalanceEl = document.getElementById("latest-balance");
const todayUsageEl = document.getElementById("today-usage");
const lastSyncEl = document.getElementById("last-sync");
const statusTextEl = document.getElementById("status-text");

const chart = echarts.init(chartDom);

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

function renderChart(points) {
  const labels = points.map((item) => item.day.slice(5));
  const values = points.map((item) => item.consumption);

  chart.setOption(
    {
      animationDuration: 400,
      grid: {
        left: 24,
        right: 18,
        top: 35,
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
      yAxis: {
        type: "value",
        name: "元",
        axisLine: { lineStyle: { color: "#9ca8b8" } },
        splitLine: { lineStyle: { color: "#eef1f5" } },
      },
      series: [
        {
          name: "电费消耗",
          type: "bar",
          data: values,
          barMaxWidth: 22,
          itemStyle: {
            color: "#2f7b6d",
            borderRadius: [4, 4, 0, 0],
          },
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

async function refresh() {
  try {
    const [status, chartData] = await Promise.all([fetchJson("/api/status"), fetchJson("/api/chart?days=30")]);

    latestBalanceEl.textContent = status.latestBalance == null ? "--" : `${status.latestBalance} 元`;
    todayUsageEl.textContent = `${status.todayConsumption ?? 0} 元`;
    lastSyncEl.textContent = formatDateTime(status.lastSyncAt);

    statusTextEl.textContent = status.lastError ? `采集异常: ${status.lastError}` : "运行正常";
    statusTextEl.classList.toggle("error", Boolean(status.lastError));

    renderChart(chartData.points || []);
  } catch (error) {
    statusTextEl.textContent = `加载失败: ${error.message}`;
    statusTextEl.classList.add("error");
  }
}

window.addEventListener("resize", () => chart.resize());

refresh();
setInterval(refresh, 60 * 1000);
