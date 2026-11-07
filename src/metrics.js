const config = require("./config");
const os = require("os");

const requestMethods = new Set(["GET", "PUT", "POST", "DELETE"]);
const activeUserTimeoutMs = 5 * 60 * 1000;
const latencyBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const counters = new Map();
const gauges = new Map();
const histograms = new Map();
const activeUsers = new Map();
const metricStartTimeUnixNano = (BigInt(Date.now()) * 1000000n).toString();
let previousCpuTimes;

function seriesKey(attributes) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(attributes).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function recordCounter(name, value, unit, attributes = {}) {
  if (!counters.has(name)) {
    counters.set(name, { unit, series: new Map() });
  }

  const metric = counters.get(name);
  const key = seriesKey(attributes);
  const series = metric.series.get(key) || { value: 0, attributes };
  series.value += value;
  metric.series.set(key, series);
}

function setGauge(name, value, unit, attributes = {}) {
  if (!gauges.has(name)) {
    gauges.set(name, { unit, series: new Map() });
  }

  gauges.get(name).series.set(seriesKey(attributes), { value, attributes });
}

function recordHistogram(name, value, unit, attributes = {}) {
  if (!histograms.has(name)) {
    histograms.set(name, { unit, series: new Map() });
  }

  const metric = histograms.get(name);
  const key = seriesKey(attributes);
  const series = metric.series.get(key) || {
    count: 0,
    sum: 0,
    bucketCounts: Array(latencyBuckets.length + 1).fill(0),
    attributes,
  };
  const bucketIndex = latencyBuckets.findIndex((bound) => value <= bound);
  series.bucketCounts[bucketIndex === -1 ? latencyBuckets.length : bucketIndex] +=
    1;
  series.count += 1;
  series.sum += value;
  metric.series.set(key, series);
}

function getEndpoint(req) {
  const routePath = req.route && req.route.path;
  if (typeof routePath !== "string") {
    return req.path;
  }

  const pathSegments = req.path.split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);
  const prefix = pathSegments.slice(
    0,
    Math.max(0, pathSegments.length - routeSegments.length),
  );
  return `/${[...prefix, ...routeSegments].join("/")}`;
}

function requestTracker(req, res, next) {
  const startedAt = process.hrtime.bigint();
  if (req.user) {
    activeUsers.set(String(req.user.id), Date.now());
  }

  res.once("finish", () => {
    if (!requestMethods.has(req.method)) {
      return;
    }

    const endpoint = getEndpoint(req);
    const attributes = {
      method: req.method,
      endpoint,
      status_code: String(res.statusCode),
    };
    recordCounter("total_requests", 1, "requests");
    recordCounter("http_requests", 1, "requests", attributes);
    recordHistogram(
      "service_endpoint_latency",
      Number(process.hrtime.bigint() - startedAt) / 1e6,
      "ms",
      { method: req.method, endpoint },
    );
  });

  next();
}

function trackAuthenticationAttempt(successful) {
  recordCounter("authentication_attempts", 1, "attempts", {
    result: successful ? "success" : "failure",
  });
}

function trackPizzaSale(items) {
  recordCounter("pizzas_sold", items.length, "pizzas");
  const revenue = items.reduce((total, item) => {
    const price = Number(item.price);
    return Number.isFinite(price) ? total + price : total;
  }, 0);
  recordCounter("pizza_revenue", revenue, "currency");
}

function trackPizzaCreation(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    recordHistogram(
      "pizza_creation_latency",
      Number(process.hrtime.bigint() - startedAt) / 1e6,
      "ms",
    );
    if (res.statusCode >= 400) {
      recordCounter("pizza_creation_failures", 1, "failures");
    }
  });
  next();
}

function getCpuUsagePercentage() {
  const cpuTimes = os.cpus().reduce(
    (total, cpu) => {
      for (const [state, time] of Object.entries(cpu.times)) {
        total[state] = (total[state] || 0) + time;
      }
      return total;
    },
    {},
  );
  const totalTime = Object.values(cpuTimes).reduce(
    (total, time) => total + time,
    0,
  );

  if (!previousCpuTimes) {
    previousCpuTimes = { idle: cpuTimes.idle, total: totalTime };
    return 0;
  }

  const totalDelta = totalTime - previousCpuTimes.total;
  const idleDelta = cpuTimes.idle - previousCpuTimes.idle;
  previousCpuTimes = { idle: cpuTimes.idle, total: totalTime };
  return totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
}

function getMemoryUsagePercentage() {
  return ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
}

function getActiveUserCount(now = Date.now()) {
  for (const [userId, lastSeen] of activeUsers) {
    if (now - lastSeen > activeUserTimeoutMs) {
      activeUsers.delete(userId);
    }
  }
  return activeUsers.size;
}

function createDataPoint(value, attributes, valueType, cumulative = false) {
  const dataPoint = {
    [valueType]: value,
    timeUnixNano: (BigInt(Date.now()) * 1000000n).toString(),
    attributes: Object.entries(attributes).map(([key, attributeValue]) => ({
      key,
      value: { stringValue: String(attributeValue) },
    })),
  };
  if (cumulative) {
    dataPoint.startTimeUnixNano = metricStartTimeUnixNano;
  }
  return dataPoint;
}

function buildMetrics() {
  const metrics = [];

  for (const [name, metric] of counters) {
    metrics.push({
      name,
      unit: metric.unit,
      sum: {
        dataPoints: Array.from(metric.series.values(), (series) =>
          createDataPoint(
            series.value,
            series.attributes,
            "asDouble",
            true,
          ),
        ),
        aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
        isMonotonic: true,
      },
    });
  }

  for (const [name, metric] of gauges) {
    metrics.push({
      name,
      unit: metric.unit,
      gauge: {
        dataPoints: Array.from(metric.series.values(), (series) =>
          createDataPoint(series.value, series.attributes, "asDouble"),
        ),
      },
    });
  }

  for (const [name, metric] of histograms) {
    metrics.push({
      name,
      unit: metric.unit,
      histogram: {
        dataPoints: Array.from(metric.series.values(), (series) => ({
          count: String(series.count),
          sum: series.sum,
          bucketCounts: series.bucketCounts.map(String),
          explicitBounds: latencyBuckets,
          startTimeUnixNano: metricStartTimeUnixNano,
          timeUnixNano: (BigInt(Date.now()) * 1000000n).toString(),
          attributes: Object.entries(series.attributes).map(
            ([key, value]) => ({
              key,
              value: { stringValue: String(value) },
            }),
          ),
        })),
        aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      },
    });
  }

  return metrics;
}

function sendMetrics() {
  setGauge("active_users", getActiveUserCount(), "users");
  setGauge("cpu_usage_percentage", getCpuUsagePercentage(), "%");
  setGauge("memory_usage_percentage", getMemoryUsagePercentage(), "%");

  const body = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: config.metrics.source },
            },
          ],
        },
        scopeMetrics: [
          {
            metrics: buildMetrics(),
          },
        ],
      },
    ],
  };
  const authorization = Buffer.from(
    `${config.metrics.accountId}:${config.metrics.apiKey}`,
  ).toString("base64");

  fetch(config.metrics.endpointUrl, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP status: ${response.status}`);
      }
    })
    .catch((error) => {
      console.error("Error pushing metrics:", error);
    });
}

if (process.env.NODE_ENV !== "test") {
  const metricsTimer = setInterval(sendMetrics, 10000);
  metricsTimer.unref();
}

module.exports = {
  requestTracker,
  trackAuthenticationAttempt,
  trackPizzaSale,
  trackPizzaCreation,
};
