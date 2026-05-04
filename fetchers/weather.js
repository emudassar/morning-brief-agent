// weather.js — OpenWeatherMap current conditions for a city
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const axios = require("axios");

const fetchWeather = async (city) => {
  try {
    const url =
      "https://api.openweathermap.org/data/2.5/weather" +
      `?q=${encodeURIComponent(city)}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`;

    const { data } = await axios.get(url);

    return {
      city: data.name,
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      condition: data.weather[0].description,
      windSpeed: Math.round(data.wind.speed * 3.6),
      icon: data.weather[0].icon || data.weather[0].main,
    };
  } catch (err) {
    console.error("Weather fetch failed:", err.message);
    return null;
  }
};

module.exports = { fetchWeather };

/*
Quick manual test (run from server/ — .env is loaded by this module):

node -e "const { fetchWeather } = require('./fetchers/weather'); fetchWeather('London').then(console.log);"
*/
