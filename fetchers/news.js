// news.js — NewsData.io top headlines (hourly cache for quota)
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const axios = require("axios");

let newsCache = { data: null, fetchedAt: null };

const fetchNews = async (country = "us") => {
  try {
    const cacheAge = newsCache.fetchedAt ? (Date.now() - newsCache.fetchedAt) / 60000 : 999;
    if (newsCache.data && cacheAge < 60) return newsCache.data;

    const url =
      `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}` +
      `&country=${country}&language=en&category=top&size=5`;

    const { data } = await axios.get(url);

    const headlines = (data.results || []).slice(0, 5).map((a) => ({
      title: a.title,
      source: a.source_id || a.source_name || null,
    }));

    newsCache = { data: headlines, fetchedAt: Date.now() };
    return headlines;
  } catch (err) {
    console.error("News fetch failed:", err.message);
    return [];
  }
};

module.exports = { fetchNews };

/*
Quick manual test (run from server/ — .env is loaded by this module):

node -e "const { fetchNews } = require('./fetchers/news'); fetchNews('us').then(console.log);"
*/
