// scheduler.js — node-cron: exact-minute + catch-up after Render sleep; structured logging and status export
const cron = require("node-cron");
const moment = require("moment-timezone");
const User = require("../models/User");
const { runBriefingJob } = require("../jobs/briefingJob");

/** Minutes after scheduled briefing time before catch-up may fire (avoids duplicate while exact-minute job finishes). */
const CATCHUP_GRACE_MINUTES = 2;

/** Delay before first tick after process start (wake / deploy catch-up). */
const STARTUP_TICK_DELAY_MS = 4000;

/** At most one scheduler-driven briefing attempt per user per local calendar day (prevents catch-up spam when lastBriefingAt is unchanged). */
const lastSchedulerAttemptDayKey = new Map();

const schedulerState = {
  startedAt: null,
  cronRegistered: false,
  lastTickStartedAt: null,
  lastTickFinishedAt: null,
  lastTickDurationMs: null,
  lastTickUserCount: 0,
  lastDispatched: [],
  lastSkipCounts: {},
  lastError: null,
  tickCount: 0,
};

function getSchedulerStatus() {
  const approxNext = new Date();
  approxNext.setUTCSeconds(0, 0);
  approxNext.setUTCMinutes(approxNext.getUTCMinutes() + 1);

  return {
    startedAt: schedulerState.startedAt,
    cronRegistered: schedulerState.cronRegistered,
    cronPattern: "* * * * *",
    approximateNextCronUtc: approxNext.toISOString(),
    lastTickStartedAt: schedulerState.lastTickStartedAt,
    lastTickFinishedAt: schedulerState.lastTickFinishedAt,
    lastTickDurationMs: schedulerState.lastTickDurationMs,
    lastTickUserCount: schedulerState.lastTickUserCount,
    lastDispatched: [...schedulerState.lastDispatched],
    lastSkipCounts: { ...schedulerState.lastSkipCounts },
    lastError: schedulerState.lastError,
    totalTicks: schedulerState.tickCount,
  };
}

function briefingMomentToday(localNow, briefingTimeStr) {
  const raw = (briefingTimeStr || "08:00").trim();
  const parts = raw.split(":");
  const h = parseInt(parts[0], 10);
  const min = parseInt(parts[1] ?? "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return localNow.clone().startOf("day").hour(h).minute(min).second(0).millisecond(0);
}

function sentBriefingToday(user, localNow) {
  if (!user.lastBriefingAt) return false;
  return moment(user.lastBriefingAt).tz(user.timezone).isSame(localNow, "day");
}

async function runSchedulerTick(trigger) {
  const tickStart = Date.now();
  schedulerState.lastTickStartedAt = new Date().toISOString();
  schedulerState.lastError = null;
  schedulerState.tickCount += 1;

  const skipCounts = {
    too_early: 0,
    already_sent_today: 0,
    post_briefing_grace: 0,
    invalid_briefing_time: 0,
    scheduler_already_invoked_today: 0,
  };
  const dispatched = [];

  try {
    const users = await User.find({ isActive: true, telegramChatId: { $ne: null } });
    schedulerState.lastTickUserCount = users.length;

    console.log(
      `[scheduler] Tick #${schedulerState.tickCount} (${trigger}) — scanning ${users.length} active user(s) with Telegram`
    );

    for (const user of users) {
      const localNow = moment().tz(user.timezone);
      const localHHMM = localNow.format("HH:mm");

      if (sentBriefingToday(user, localNow)) {
        skipCounts.already_sent_today += 1;
        continue;
      }

      const briefingToday = briefingMomentToday(localNow, user.briefingTime);
      if (!briefingToday) {
        skipCounts.invalid_briefing_time += 1;
        console.warn(
          `[scheduler] Skip invalid briefingTime for ${user.email}: "${user.briefingTime}"`
        );
        continue;
      }

      if (localNow.isBefore(briefingToday)) {
        skipCounts.too_early += 1;
        continue;
      }

      const isExactMinute = localHHMM === user.briefingTime;
      const catchUpThreshold = briefingToday.clone().add(CATCHUP_GRACE_MINUTES, "minutes");
      const catchUpEligible = !localNow.isBefore(catchUpThreshold);

      if (!isExactMinute && !catchUpEligible) {
        skipCounts.post_briefing_grace += 1;
        continue;
      }

      const dayKey = localNow.format("YYYY-MM-DD");
      const uid = String(user._id);
      if (lastSchedulerAttemptDayKey.get(uid) === dayKey) {
        skipCounts.scheduler_already_invoked_today += 1;
        continue;
      }

      const mode = isExactMinute ? "exact" : "catch-up";
      console.log(
        `[scheduler] Match (${mode}) → ${user.email} local=${localHHMM} TZ=${user.timezone} briefingTime=${user.briefingTime}`
      );
      dispatched.push({ email: user.email, mode });

      lastSchedulerAttemptDayKey.set(uid, dayKey);

      try {
        runBriefingJob(user._id);
      } catch (err) {
        console.error(`[scheduler] runBriefingJob threw for ${user.email}:`, err.message);
      }
    }

    schedulerState.lastDispatched = dispatched.map((d) => `${d.email}:${d.mode}`);
    schedulerState.lastSkipCounts = { ...skipCounts };

    const skipSummary = Object.entries(skipCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    const dispatchSummary =
      dispatched.length === 0
        ? "none"
        : dispatched.map((d) => `${d.email} (${d.mode})`).join(", ");

    console.log(
      `[scheduler] Tick summary — dispatched: ${dispatchSummary}${skipSummary ? ` | skipped: ${skipSummary}` : ""}`
    );
  } catch (err) {
    schedulerState.lastError = err.message;
    console.error("[scheduler] Tick failed:", err.message);
  } finally {
    schedulerState.lastTickFinishedAt = new Date().toISOString();
    schedulerState.lastTickDurationMs = Date.now() - tickStart;
  }
}

const startScheduler = () => {
  if (schedulerState.cronRegistered) {
    console.warn("[scheduler] startScheduler called again — cron already registered; skipping duplicate");
    return;
  }

  schedulerState.startedAt = new Date().toISOString();
  schedulerState.cronRegistered = true;

  console.log(`[scheduler] Initializing node-cron pattern (* * * * *) at ${schedulerState.startedAt}`);

  cron.schedule("* * * * *", async () => {
    await runSchedulerTick("cron");
  });

  console.log(
    "[scheduler] Cron registered — runs every wall-clock minute; each user's local time + catch-up after missed window"
  );

  setTimeout(() => {
    runSchedulerTick("startup_wake").catch((err) => {
      console.error("[scheduler] startup_wake tick failed:", err.message);
    });
  }, STARTUP_TICK_DELAY_MS);
};

module.exports = { startScheduler, getSchedulerStatus };
