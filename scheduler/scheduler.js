// scheduler.js — node-cron: match each user's local briefing time and trigger jobs
const cron = require("node-cron");
const moment = require("moment-timezone");
const User = require("../models/User");
const { runBriefingJob } = require("../jobs/briefingJob");

const startScheduler = () => {
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const users = await User.find({ isActive: true, telegramChatId: { $ne: null } });

        for (const user of users) {
          const localNow = moment().tz(user.timezone);
          const localHHMM = localNow.format("HH:mm");

          if (localHHMM !== user.briefingTime) continue;

          if (user.lastBriefingAt) {
            const lastSentLocal = moment(user.lastBriefingAt).tz(user.timezone);
            if (lastSentLocal.isSame(localNow, "day")) continue;
          }

          console.log("[scheduler] Triggering briefing for", user.email);
          runBriefingJob(user._id);
        }
      } catch (err) {
        console.error("[scheduler] Error:", err.message);
      }
    }
  );

  console.log("Scheduler started — checking every 60 seconds");
};

module.exports = { startScheduler };
