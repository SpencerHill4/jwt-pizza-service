const config = require("./config");
const { AsyncLocalStorage } = require("node:async_hooks");
const sensitiveField =
  /password|passwd|passphrase|secret|token|jwt|authorization|cookie|api[-_]?key|credential|email|phone|address|ssn|credit.?card|card.?number|cvv/i;
const sensitiveText =
  /(["']?)(password|passwd|passphrase|secret|token|jwt|authorization|cookie|api[-_]?key|credential|email|phone|address|ssn|credit.?card|card.?number|cvv)(["']?)\s*([:=])\s*("[^"]*"|'[^']*'|(?!\?)[^\s,;]+)/gi;
const requestContext = new AsyncLocalStorage();

class Logger {
  httpLogger = (req, res, next) => {
    let send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        user: this.userInfo(req.user),
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: JSON.stringify(req.body),
        resBody: JSON.stringify(resBody),
      };
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, "http", logData);
      res.send = send;
      return res.send(resBody);
    };
    requestContext.run({ req }, next);
  };

  dbLogger(query, user) {
    this.log("info", "db", {
      query,
      user: this.userInfo(user ?? requestContext.getStore()?.req.user),
    });
  }

  factoryLogger(requestBody, responseBody, user) {
    this.log("info", "factory", {
      user: this.userInfo(user ?? requestContext.getStore()?.req.user),
      reqBody: JSON.stringify(requestBody),
      resBody: JSON.stringify(responseBody),
    });
  }

  unhandledErrorLogger(err) {
    this.log("error", "unhandledError", {
      message: err.message,
      statusCode: err.statusCode,
    });
  }

  userInfo(user) {
    return user ? { id: user.id, name: user.name } : "";
  }

  log(level, type, logData) {
    const labels = {
      component: config.logging.source,
      level: level,
      type: type,
    };
    const values = [this.nowString(), this.sanitize(logData)];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return "error";
    if (statusCode >= 400) return "warn";
    return "info";
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  sanitize(logData) {
    return JSON.stringify(this.sanitizeValue(logData));
  }

  sanitizeValue(value, key) {
    if (key && sensitiveField.test(key)) return "[REDACTED]";

    if (typeof value === "string") {
      if (key === "query") return this.sanitizeQuery(value);
      if (key === "reqBody" || key === "resBody") {
        try {
          return JSON.stringify(this.sanitizeValue(JSON.parse(value)));
        } catch {
          return this.sanitizeString(value);
        }
      }
      return this.sanitizeString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          this.sanitizeValue(entryValue, entryKey),
        ]),
      );
    }

    return value;
  }

  sanitizeQuery(query) {
    return this.sanitizeString(
      query.replace(/'(?:''|\\.|[^'])*'|"(?:[^"]|"")*"/g, "?"),
    );
  }

  sanitizeString(value) {
    return value
      .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
      .replace(sensitiveText, '$1$2$3$4[REDACTED]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    fetch(`${config.logging.endpointUrl}`, {
      method: "post",
      body: body,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
      },
    }).then((res) => {
      if (!res.ok) console.log("Failed to send log to Grafana");
    });
  }
}
module.exports = new Logger();
