const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Auth token missing" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, companyId }
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
