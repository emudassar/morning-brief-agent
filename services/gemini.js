// gemini.js — Gemini 1.5 Flash REST API for briefing text generation
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const axios = require("axios");

/**
 * AI Studio `generateContent` endpoint.
 * Use `gemini-flash-latest` so the key targets the current Flash model (older ids like `gemini-1.5-flash` 404; some `gemini-2.0-*` free quotas show limit 0).
 */
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

function buildFallbackBriefing({ userName, date, weather, news, calendar }) {
  const weatherLines = weather
    ? [
        `☀️ *Weather in ${weather.city}*`,
        `- Temperature: *${weather.temp}°C* (feels like ${weather.feelsLike}°C)`,
        `- Condition: ${weather.condition}`,
        `- Humidity: ${weather.humidity}%`,
        `- Wind: ${weather.windSpeed} km/h`,
      ]
    : ["☀️ *Weather*", "- Weather data is unavailable right now."];

  const calendarLines =
    calendar && calendar.length
      ? [
          "📅 *Today's Schedule*",
          ...calendar.map((e) => `- ${e.time}: ${e.title}`),
        ]
      : ["📅 *Today's Schedule*", "- No calendar events for today."];

  const newsLines =
    news && news.length
      ? ["📰 *Top News*", ...news.slice(0, 5).map((n, i) => `- ${i + 1}. ${n.title}`)]
      : ["📰 *Top News*", "- No news headlines available right now."];

  const quoteLine = "_\"Success is the sum of small efforts, repeated day in and day out.\" — Robert Collier_";

  return [
    `Good morning ${userName}! Here is your briefing for ${date}.`,
    "",
    ...weatherLines,
    "",
    ...calendarLines,
    "",
    ...newsLines,
    "",
    quoteLine,
    "",
    "/briefing to refresh | /pause to stop",
  ].join("\n");
}

function isCompleteBriefing(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = text.toLowerCase();
  const hasWeather = /weather|temperature|humidity|wind/.test(normalized);
  const hasNews = /news|headline/.test(normalized);
  const hasSchedule = /calendar|schedule|event/.test(normalized);
  return hasWeather && hasNews && hasSchedule && text.trim().length >= 220;
}

function buildPrompt({ userName, date, weather, news, calendar }) {
  const weatherText = weather
    ? `${weather.city}, ${weather.temp}, ${weather.feelsLike}, ${weather.condition}, ${weather.humidity}, ${weather.windSpeed}`
    : "Weather unavailable";

  const newsText =
    news && news.length
      ? news.map((n, i) => `${i + 1}. ${n.title} [${n.source}]`).join("\n")
      : "No news";

  const calendarText =
    calendar && calendar.length
      ? calendar.map((e) => `- ${e.time}: ${e.title}`).join("\n")
      : "No calendar events";

  return `You are a friendly, concise personal morning briefing assistant.

Write a morning briefing for ${userName} for ${date}.

Format it for Telegram (supports *bold* and _italic_ markdown).

RAW DATA:

WEATHER: ${weatherText}

CALENDAR EVENTS TODAY: ${calendarText}

TOP NEWS: ${newsText}

INSTRUCTIONS:

- Open with: 'Good morning ${userName}! Here is your briefing for ${date}'

- Weather section: emoji, temp, condition, brief practical tip

- Calendar section: emoji, list events, suggest deep-work window if gaps exist

- News section: emoji, list top 3 headlines clearly

- End with: one motivational quote with author attribution

- Final line: /briefing to refresh | /pause to stop

- Max 380 words. Warm but efficient tone.`;
}

async function generateBriefing(data) {
  const fallback = buildFallbackBriefing(data);
  try {
    const prompt = buildPrompt(data);
    const response = await axios.post(
      `${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.75 },
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("Gemini API error: empty candidates/parts", JSON.stringify(response.data));
      return fallback;
    }
    if (!isCompleteBriefing(text)) {
      console.warn("Gemini returned incomplete briefing; using fallback formatter.");
      return fallback;
    }
    return text;
  } catch (err) {
    console.error("Gemini API error:", err.response?.data || err.message);
    return fallback;
  }
}

module.exports = { generateBriefing };

/*
Verify from server/ (.env loads GEMINI_API_KEY automatically):

node -e "const {generateBriefing}=require('./services/gemini'); generateBriefing({userName:'TestUser',date:'Monday, April 28',weather:{city:'London',temp:15,feelsLike:13,humidity:60,condition:'cloudy',windSpeed:20},news:[{title:'Test news',source:'bbc'}],calendar:[]}).then(console.log);"

Expect: multi-paragraph briefing with greeting, weather, news (≥1 headline), quote, and final “/briefing … | /pause …” line (retry if Google returns 429/503 briefly).
*/
