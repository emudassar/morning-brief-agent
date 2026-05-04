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
const { startScheduler } = require("./scheduler/scheduler");

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
app.use(express.json());

app.use("/api/auth", auth);
app.use("/api/user", user);
app.use("/api/briefing", briefing);

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date() });
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
