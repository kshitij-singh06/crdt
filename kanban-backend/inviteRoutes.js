const express = require("express");
const crypto = require("crypto");
const { pool } = require("./db");
const { requireAuth } = require("./authMiddleware");

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /boards/:boardId/invites — Generate an invite link
// ---------------------------------------------------------------------------
// Owner/editor only (checked manually here since requireRole reads boardId
// from req.params.boardId, but we mount these routes at different paths).
router.post("/boards/:boardId/invites", requireAuth, async (req, res) => {
  const { boardId } = req.params;
  const { email, role } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: "email and role are required" });
  }
  if (!["owner", "editor", "viewer"].includes(role)) {
    return res.status(400).json({ error: "role must be owner, editor, or viewer" });
  }

  try {
    // Verify the requester is an owner or editor on this board.
    const memberCheck = await pool.query(
      "SELECT role FROM board_member WHERE board_id = $1 AND user_id = $2",
      [boardId, req.userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: "You are not a member of this board" });
    }
    const requesterRole = memberCheck.rows[0].role;
    if (!["owner", "editor"].includes(requesterRole)) {
      return res.status(403).json({ error: "Only owners and editors can invite members" });
    }

    // Generate a crypto-random, unguessable token (32 bytes = 64 hex chars).
    const token = crypto.randomBytes(32).toString("hex");

    const result = await pool.query(
      `INSERT INTO board_invite (board_id, email, role, token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, board_id, email, role, token, created_at`,
      [boardId, email, role, token]
    );

    const invite = result.rows[0];
    const inviteLink = `http://localhost:5173/invite/${token}`;

    res.status(201).json({ invite, inviteLink });
  } catch (err) {
    console.error("Create invite error:", err);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

// ---------------------------------------------------------------------------
// GET /invites/:token — Look up invite details (for the accept page)
// ---------------------------------------------------------------------------
router.get("/invites/:token", requireAuth, async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT bi.id, bi.board_id, bi.email, bi.role, bi.token, bi.created_at, bi.accepted_at,
              b.name AS board_name
       FROM board_invite bi
       JOIN board b ON b.id = bi.board_id
       WHERE bi.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invite not found" });
    }

    res.json({ invite: result.rows[0] });
  } catch (err) {
    console.error("Get invite error:", err);
    res.status(500).json({ error: "Failed to fetch invite" });
  }
});

// ---------------------------------------------------------------------------
// POST /invites/:token/accept — Accept an invite
// ---------------------------------------------------------------------------
router.post("/invites/:token/accept", requireAuth, async (req, res) => {
  const { token } = req.params;

  try {
    // Look up the invite.
    const inviteResult = await pool.query(
      `SELECT bi.id, bi.board_id, bi.email, bi.role, bi.accepted_at
       FROM board_invite bi
       WHERE bi.token = $1`,
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: "Invite not found" });
    }

    const invite = inviteResult.rows[0];

    if (invite.accepted_at) {
      return res.status(409).json({ error: "This invite has already been accepted" });
    }

    // Verify the logged-in user's email matches the invited email.
    const userResult = await pool.query(
      "SELECT email FROM users WHERE user_id = $1",
      [req.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    if (userResult.rows[0].email !== invite.email) {
      return res.status(403).json({
        error: "This invite was sent to a different email address",
      });
    }

    // Create the board_member row and mark the invite as accepted.
    // Use a transaction so both succeed or fail together.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO board_member (board_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [invite.board_id, req.userId, invite.role]
      );

      await client.query(
        `UPDATE board_invite SET accepted_at = now() WHERE id = $1`,
        [invite.id]
      );

      await client.query("COMMIT");

      res.json({
        message: "Invite accepted",
        boardId: invite.board_id,
        role: invite.role,
      });
    } catch (innerErr) {
      await client.query("ROLLBACK");

      // 23505 = unique_violation — user is already a member of this board.
      // This can happen if someone generates an invite for an existing member,
      // or if the user was added directly via POST /boards/:boardId/members
      // before accepting the invite. Handle gracefully instead of 500-ing.
      if (innerErr.code === "23505") {
        // Still mark the invite as accepted so it can't be re-used.
        await pool.query(
          `UPDATE board_invite SET accepted_at = now() WHERE id = $1`,
          [invite.id]
        );
        return res.status(409).json({
          error: "You are already a member of this board",
          boardId: invite.board_id,
        });
      }

      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Accept invite error:", err);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

module.exports = router;
