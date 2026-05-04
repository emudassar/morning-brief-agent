// briefingJob.js — fetch data, generate briefing via Gemini, send Telegram, persist history
const User = require("../models/User");
const Briefing = require("../models/Briefing");
const { fetchWeather } = require("../fetchers/weather");
const { fetchNews } = require("../fetchers/news");
const { fetchCalendar } = require("../fetchers/calendar");
const { generateBriefing } = require("../services/gemini");

async function runBriefingJob(userId) {
  console.log("[briefingJob] Starting for userId:", userId);
  let briefingDoc;

  try {
    const user = await User.findById(userId);
    if (!user || !user.telegramChatId) {
      console.warn(`[briefingJob] User ${userId} missing or no telegramChatId. Skipping.`);
      return;
    }

    briefingDoc = await Briefing.create({ userId, status: "pending", content: "" });

    const [weather, news, calendar] = await Promise.all([
      user.modules.weather ? fetchWeather(user.city) : Promise.resolve(null),
      user.modules.news ? fetchNews(user.country) : Promise.resolve([]),
      user.modules.calendar ? fetchCalendar(user.googleOAuth) : Promise.resolve([]),
    ]);

    const briefingText = await generateBriefing({
      userName: user.email.split("@")[0],
      date: new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
      weather,
      news,
      calendar,
    });

    const { sendTelegramMessage } = require("../services/telegram");
    await sendTelegramMessage(user.telegramChatId, briefingText);

    await Briefing.findByIdAndUpdate(briefingDoc._id, {
      content: briefingText,
      status: "sent",
      sentAt: new Date(),
    });

    await User.findByIdAndUpdate(userId, { lastBriefingAt: new Date() });

    console.log("[briefingJob] Sent to", user.email);
  } catch (err) {
    console.error(err);
    if (briefingDoc) {
      await Briefing.findByIdAndUpdate(briefingDoc._id, {
        status: "failed",
        errorMessage: err.message,
      });
    }
  }
}

module.exports = { runBriefingJob };
