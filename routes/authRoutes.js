const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

function sign(user) {
  return jwt.sign(
    { id: user._id, role: user.role, companyId: user.companyId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// Signup
router.post("/signup", async (req, res) => {
  try {
    const { username, email, password, companyName, phone, role } = req.body;
    const companyId = (companyName || "default").toLowerCase().replace(/\s+/g, "-");
    const user = await User.create({ username, email, password, companyId, phone, role: role || "agent" });
    const token = sign(user);
    res.json({ user: { id: user._id, email, role: user.role, companyId: user.companyId, username }, token });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const token = sign(user);
  res.json({ user: { id: user._id, email, role: user.role, companyId: user.companyId, username: user.username }, token });
});

// Forgot password (stub)
router.post("/forgot", async (req, res) => {
  // Implement email flow as you like
  res.json({ message: "If the email exists, a reset link will be sent." });
});

module.exports = router;
