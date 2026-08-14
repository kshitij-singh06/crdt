const express = require("express");
const { pool } = require("./db");
const { requireAuth, requireRole } = require("./authMiddleware");

const router = express.Router();

// -----------------------------------------------------------------------
// POST /boards
// Creates a board AND makes the creator its 'owner' member, atomically.
//
// WHY A TRANSACTION: this is two separate INSERTs (board, then
// board_member). Without wrapping them in a transaction, a crash or DB
// error between the two statements would leave a board with NO owner --
// an orphaned board nobody has a role on, which every other route
// (requireRole) would then be unable to grant access to, since it
// can't find a board_member row at all. BEGIN/COMMIT makes both inserts
// succeed or fail together; ROLLBACK on any error undoes both.
// -----------------------------------------------------------------------
router.post("/", requireAuth, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Board name is required" });
  }

  const client = await pool.connect(); // checked out from the pool so all
                                        // statements in this transaction
                                        // run on the SAME connection
  try {
    await client.query("BEGIN");

    const boardResult = await client.query(
      `INSERT INTO board (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id, created_at`,
      [name, req.userId]
    );
    const board = boardResult.rows[0];

    await client.query(
      `INSERT INTO board_member (board_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [board.id, req.userId]
    );

    await client.query("COMMIT");

    res.status(201).json({ board });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Board creation error:", err);
    res.status(500).json({ error: "Failed to create board" });
  } finally {
    client.release(); // always return the connection to the pool
  }
});

// -----------------------------------------------------------------------
// POST /boards/:boardId/members
// Adds an existing user to a board by email. Only owner/editor can invite
// (viewers shouldn't be able to grant others access) -- adjust if you
// want this owner-only instead, that's a product decision, not a
// technical one.
// -----------------------------------------------------------------------
router.post(
  "/:boardId/members",
  requireAuth,
  requireRole("owner", "editor"),
  async (req, res) => {
    const { boardId } = req.params;
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: "email and role are required" });
    }
    if (!["owner", "editor", "viewer"].includes(role)) {
      return res.status(400).json({ error: "role must be owner, editor, or viewer" });
    }

    try {
      const userResult = await pool.query("SELECT user_id FROM users WHERE email = $1", [email]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: "No user found with that email" });
      }
      const targetUserId = userResult.rows[0].user_id;

      const memberResult = await pool.query(
        `INSERT INTO board_member (board_id, user_id, role)
         VALUES ($1, $2, $3)
         RETURNING id, board_id, user_id, role`,
        [boardId, targetUserId, role]
      );

      res.status(201).json({ member: memberResult.rows[0] });
    } catch (err) {
      // Postgres error code 23505 = unique_violation -- fires here if the
      // user is already a member of this board (UNIQUE(board_id, user_id)).
      if (err.code === "23505") {
        return res.status(409).json({ error: "This user is already a member of the board" });
      }
      console.error("Add member error:", err);
      res.status(500).json({ error: "Failed to add member" });
    }
  }
);

// -----------------------------------------------------------------------
// GET /boards/:boardId
// Fetches full board state: board metadata, members, columns, and cards.
// Any member (owner/editor/viewer) can read -- requireRole with all
// three roles listed makes that explicit rather than skipping the check.
// -----------------------------------------------------------------------
router.get(
  "/:boardId",
  requireAuth,
  requireRole("owner", "editor", "viewer"),
  async (req, res) => {
    const { boardId } = req.params;

    try {
      const boardResult = await pool.query("SELECT * FROM board WHERE id = $1", [boardId]);
      if (boardResult.rows.length === 0) {
        return res.status(404).json({ error: "Board not found" });
      }

      // Running these three independent queries concurrently rather than
      // one-after-another -- they don't depend on each other's results,
      // so awaiting them sequentially would just add latency for no reason.
      const [membersResult, columnsResult, cardsResult] = await Promise.all([
        pool.query(
          `SELECT bm.user_id, bm.role, u.name, u.email
           FROM board_member bm JOIN users u ON u.user_id = bm.user_id
           WHERE bm.board_id = $1`,
          [boardId]
        ),
        pool.query(
          `SELECT id, title, position FROM board_column WHERE board_id = $1 ORDER BY position`,
          [boardId]
        ),
        pool.query(
          `SELECT c.id, c.column_id, c.title, c.description, c.assignee_id, c.position
           FROM card c
           JOIN board_column bc ON bc.id = c.column_id
           WHERE bc.board_id = $1
           ORDER BY c.position`,
          [boardId]
        ),
      ]);

      res.json({
        board: boardResult.rows[0],
        members: membersResult.rows,
        columns: columnsResult.rows,
        cards: cardsResult.rows,
      });
    } catch (err) {
      console.error("Fetch board error:", err);
      res.status(500).json({ error: "Failed to fetch board" });
    }
  }
);

module.exports = router;