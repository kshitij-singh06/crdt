const express = require("express");
const { pool } = require("./db");
const { requireAuth, requireRole } = require("./authMiddleware");

const router = express.Router();

// POST /boards
// Creates a board AND makes the creator its 'owner' member, atomically.
// WHY A TRANSACTION: this is two separate INSERTs (board, then board_member). Without wrapping them in a transaction, a crash or DB error between the two statements would leave a board with NO owner -- an orphaned board nobody has a role on, which every other route (requireRole) would then be unable to grant access to, since it can't find a board_member row at all. BEGIN/COMMIT makes both inserts succeed or fail together; ROLLBACK on any error undoes both.
router.post("/", requireAuth, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Board name is required" });
  }

  const client = await pool.connect(); // checked out from the pool so all statements in this transaction run on the SAME connection
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

// POST /boards/:boardId/members
// Adds an existing user to a board by email. Only owner/editor can invite (viewers shouldn't be able to grant others access) 
//adjust if you want this owner-only instead, that's a product decision, not a technical one.
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
      // Postgres error code 23505 = unique_violation :
      // fires here if the user is already a member of this board (UNIQUE(board_id, user_id)).
      if (err.code === "23505") {
        return res.status(409).json({ error: "This user is already a member of the board" });
      }
      console.error("Add member error:", err);
      res.status(500).json({ error: "Failed to add member" });
    }
  }
);

// GET /boards/:boardId
// Fetches full board state: board metadata, members, columns, and cards.
// Any member (owner/editor/viewer) can read -- requireRole with all
// three roles listed makes that explicit rather than skipping the check.
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

// POST /boards/:boardId/columns
// Creates a column on a board. owner/editor only -- viewers are read-only everywhere, including here.
router.post(
  "/:boardId/columns",
  requireAuth,
  requireRole("owner", "editor"),
  async (req, res) => {
    const { boardId } = req.params;
    const { title } = req.body;
 
    if (!title) {
      return res.status(400).json({ error: "Column title is required" });
    }
 
    try {
      // New column goes at the end -- position = current column count. Not race-safe under truly concurrent creates (two simultaneous requests could both compute the same "next" position), but for Phase 1 REST-seeded data that's an acceptable gap; live reordering once Yjs takes over uses Y.Array semantics instead, which IS concurrency-safe.
      const countResult = await pool.query(
        "SELECT COUNT(*) FROM board_column WHERE board_id = $1",
        [boardId]
      );
      const position = parseInt(countResult.rows[0].count, 10);
 
      const result = await pool.query(
        `INSERT INTO board_column (board_id, title, position)
         VALUES ($1, $2, $3)
         RETURNING id, board_id, title, position`,
        [boardId, title, position]
      );
 
      res.status(201).json({ column: result.rows[0] });
    } catch (err) {
      console.error("Create column error:", err);
      res.status(500).json({ error: "Failed to create column" });
    }
  }
);
 
// POST /boards/:boardId/columns/:columnId/cards
// Creates a card in a column. owner/editor only.
// Note boardId is in the URL for RBAC purposes (requireRole checks membership on boardId), but the actual INSERT only needs columnId -- we don't re-validate that columnId belongs to boardId here. Worth tightening later (a malicious/buggy client could pass a columnId from a DIFFERENT board they're an editor on), but out of scope for Phase 1.
router.post(
  "/:boardId/columns/:columnId/cards",
  requireAuth,
  requireRole("owner", "editor"),
  async (req, res) => {
    const { columnId } = req.params;
    const { title, description, assigneeId } = req.body;
 
    if (!title) {
      return res.status(400).json({ error: "Card title is required" });
    }
 
    try {
      const countResult = await pool.query(
        "SELECT COUNT(*) FROM card WHERE column_id = $1",
        [columnId]
      );
      const position = parseInt(countResult.rows[0].count, 10);
 
      const result = await pool.query(
        `INSERT INTO card (column_id, title, description, assignee_id, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, column_id, title, description, assignee_id, position, created_at`,
        [columnId, title, description || null, assigneeId || null, position]
      );
 
      res.status(201).json({ card: result.rows[0] });
    } catch (err) {
      // 23503 = foreign_key_violation -- fires if columnId doesn't exist
      // or assigneeId doesn't reference a real user.
      if (err.code === "23503") {
        return res.status(400).json({ error: "Invalid columnId or assigneeId" });
      }
      console.error("Create card error:", err);
      res.status(500).json({ error: "Failed to create card" });
    }
  }
);

module.exports = router;