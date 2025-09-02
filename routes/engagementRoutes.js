
const express = require("express");
const router = express.Router();
const Engagement = require("../models/Engagement");
const authMiddleware = require("../middleware/auth");

router.get("/all", authMiddleware, async (req, res) => {
  try {
    const user = req.user; // decoded from JWT
    let engagements;

    if (user.role === "admin") {
      engagements = await Engagement.find().sort({ startTime: -1 });
    } else if (user.role === "agent") {
      engagements = await Engagement.find({ agent: user.name }).sort({ startTime: -1 });
    } else {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json(engagements);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
