require("dotenv").config();

// Express API entry: middleware, REST routes, MongoDB connection, health check, and cron scheduler startup.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const db = require("./config/db");
const auth = require("./routes/auth");
const user = require("./routes/user");
const briefing = require("./routes/briefing");
const { startScheduler, getSchedulerStatus } = require("./scheduler/scheduler");

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.VERCEL_URL,
  "http://localhost:3000",
  "http://localhost:5173",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (curl, server-to-server) with no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));
app.use("/api", require("./routes/webhooks"));
app.use(express.json());

app.use("/api/auth", auth);
app.use("/api/user", user);
app.use("/api/briefing", briefing);

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Morning Briefing API",
    health: "/health",
  });
});

function safeTelegramStatus() {
  try {
    return require("./services/telegram").getTelegramBotStatus();
  } catch (err) {
    return { initialized: false, error: err.message };
  }
}

app.get("/health", (req, res) => {
  const scheduler = getSchedulerStatus();
  const telegram = safeTelegramStatus();
  res.json({
    ok: true,
    time: new Date().toISOString(),
    scheduler: {
      startedAt: scheduler.startedAt,
      cronRegistered: scheduler.cronRegistered,
      approximateNextCronUtc: scheduler.approximateNextCronUtc,
      lastTickStartedAt: scheduler.lastTickStartedAt,
      lastTickFinishedAt: scheduler.lastTickFinishedAt,
      lastTickDurationMs: scheduler.lastTickDurationMs,
      lastError: scheduler.lastError,
    },
    telegram: {
      isPolling: telegram.isPolling,
      pollingStartedAt: telegram.pollingStartedAt,
      lastPollingErrorAt: telegram.lastPollingErrorAt,
      restartInProgress: telegram.restartInProgress,
      initialized: telegram.initialized !== false,
      ...(telegram.error ? { error: telegram.error } : {}),
    },
  });
});

app.get("/debug/scheduler", (req, res) => {
  const secret = process.env.DEBUG_SCHEDULER_SECRET;
  if (!secret) {
    return res.status(503).json({
      error: "Debug disabled — set DEBUG_SCHEDULER_SECRET in the server environment",
    });
  }
  const provided = req.query.secret || req.headers["x-debug-secret"];
  if (provided !== secret) {
    return res.status(403).json({ error: "Forbidden — provide ?secret= or x-debug-secret header" });
  }

  const scheduler = getSchedulerStatus();
  const telegram = safeTelegramStatus();

  res.json({
    serverTimeUtc: new Date().toISOString(),
    scheduler,
    telegram,
  });
});

const PORT = process.env.PORT || 5000;

async function start() {
  await db();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    startScheduler();
    require("./services/telegram");
  });
}

start();
