// authController.js — JWT signup/sign-in handlers
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

exports.register = async (req, res) => {
  try {
    const { email, password, city, country, timezone } = req.body;
    if (!email || !password || !city) {
      return res.status(400).json({ error: "email, password, and city are required" });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const user = await User.create({
      email,
      passwordHash: password,
      city,
      country,
      timezone,
    });

    const token = signToken(user._id);
    return res.status(201).json({ token, userId: user._id, email: user.email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user._id);
    return res.status(200).json({ token, userId: user._id, email: user.email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
