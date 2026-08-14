const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");

const router = express.Router();
const SALT_ROUNDS = 12; // cost factor for bcrypt -- higher = slower to brute-force, slower to hash
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = "7d";

// -----------------------------------------------------------------------
// POST /auth/signup
// -----------------------------------------------------------------------
router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }

  try {
    // Check for existing email up front so we can return a clean 409
    // instead of relying solely on the DB's UNIQUE constraint error.
    const existing = await pool.query("SELECT user_id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id, name, email, user_joined`,
      [name, email, passwordHash]
    );

    const user = result.rows[0];

    const token = jwt.sign({ userId: user.user_id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Something went wrong during signup" });
  }
});

// -----------------------------------------------------------------------
// POST /auth/login
// -----------------------------------------------------------------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const result = await pool.query(
      "SELECT user_id, name, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    // Deliberately generic error message for BOTH "no such user" and
    // "wrong password" -- returning different messages for each leaks
    // whether an email is registered at all (an enumeration attack).
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.user_id }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    res.json({
      user: { user_id: user.user_id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Something went wrong during login" });
  }
});

module.exports = router;