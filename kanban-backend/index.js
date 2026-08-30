require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authRoutes = require("./authRoutes");
const boardRoutes = require("./boardRoutes");
const inviteRoutes = require("./inviteRoutes");

const app = express();

app.use(express.json());

app.use(cors());

app.use("/auth", authRoutes);
app.use("/boards", boardRoutes);
// Invite routes live at two path levels:
//   POST /boards/:boardId/invites  — create invite (nested under boards)
//   GET  /invites/:token           — look up invite (top-level)
//   POST /invites/:token/accept    — accept invite (top-level)
// Mount at "/" so both /boards/... and /invites/... paths resolve correctly.
app.use("/", inviteRoutes);


app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});