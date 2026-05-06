// briefingJob.js — fetch data, generate briefing via Gemini, send Telegram, persist history
const User = require("../models/User");
const Briefing = require("../models/Briefing");
const { fetchWeather } = require("../fetchers/weather");
const { fetchNews } = require("../fetchers/news");
const { fetchCalendar } = require("../fetchers/calendar");
const { generateBriefing } = require("../services/gemini");

let cachedNewsForFreePlan = [];

function getStartOfWeek(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

async function runBriefingJob(userId) {
  console.log("[briefingJob] Starting for userId:", userId);
  let briefingDoc;

  try {
    const user = await User.findById(userId);
    if (!user || !user.telegramChatId) {
      console.warn(`[briefingJob] User ${userId} missing or no telegramChatId. Skipping.`);
      return;
    }

    const subscription = user.subscription || {};
    const now = Date.now();

    if (subscription.plan === "trial") {
      const trialEndsAt = subscription.trialEndsAt ? new Date(subscription.trialEndsAt).getTime() : 0;
      if (now > trialEndsAt) {
        console.log(`[briefingJob] Trial expired for ${user.email}, skipping`);
        return;
      }
    }

    if (subscription.plan === "free") {
      const startOfWeek = getStartOfWeek();
      const sentThisWeek = await Briefing.countDocuments({
        userId,
        sentAt: { $gte: startOfWeek },
      });

      if (sentThisWeek >= 3) {
        console.log(`[briefingJob] Free plan limit reached for ${user.email}, skipping`);
        return;
      }

      user.modules = {
        ...user.modules,
        weather: true,
        news: true,
        calendar: false,
        crypto: false,
        quote: false,
      };
    }

    if (subscription.plan === "monthly" || subscription.plan === "yearly") {
      const currentPeriodEnd = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).getTime()
        : 0;
      if (subscription.status !== "active" || now > currentPeriodEnd) {
        console.log(`[briefingJob] Subscription inactive for ${user.email}, skipping`);
        return;
      }
    }

    briefingDoc = await Briefing.create({ userId, status: "pending", content: "" });

    const isFreePlan = subscription.plan === "free";
    const [weather, news, calendar] = await Promise.all([
      user.modules.weather ? fetchWeather(user.city) : Promise.resolve(null),
      user.modules.news
        ? (isFreePlan ? Promise.resolve(cachedNewsForFreePlan) : fetchNews(user.country))
        : Promise.resolve([]),
      user.modules.calendar ? fetchCalendar(user.googleOAuth) : Promise.resolve([]),
    ]);

    if (!isFreePlan && Array.isArray(news) && news.length > 0) {
      cachedNewsForFreePlan = news;
    }

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
