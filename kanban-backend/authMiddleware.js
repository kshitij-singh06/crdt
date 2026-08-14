const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;

// requireAuth
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization; // expected format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// requireRole(...allowedRoles)
// Looks up the requesting user's role on the specific board being acted
// on (from req.params.boardId) and rejects if their role isn't in the
// allowed list. This is the REST-layer half of RBAC from Section 6 --
// the sync-layer half gets built in Phase 4/2 when the WebSocket server
// exists.
//
// Usage: router.post('/boards/:boardId/cards', requireAuth, requireRole('owner', 'editor'), handler)
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    const { boardId } = req.params;

    try {
      const result = await pool.query(
        "SELECT role FROM board_member WHERE board_id = $1 AND user_id = $2",
        [boardId, req.userId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: "You are not a member of this board" });
      }

      const { role } = result.rows[0];

      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: `This action requires role: ${allowedRoles.join(" or ")}` });
      }

      req.boardRole = role; // handlers downstream can use this without re-querying
      next();
    } catch (err) {
      console.error("requireRole error:", err);
      res.status(500).json({ error: "Failed to verify board permissions" });
    }
  };
}

module.exports = { requireAuth, requireRole };