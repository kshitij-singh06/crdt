require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authRoutes = require("./authRoutes");

const app = express();

// Parses incoming JSON request bodies into req.body -- without this,
// req.body would be undefined on every POST.
app.use(express.json());

// Allows your React frontend (running on a different port) to call this
// API from the browser. Without this, the browser blocks the request
// before it even reaches Express, due to same-origin policy.
app.use(cors());

// Mount all /auth/* routes (signup, login) from authRoutes.js
app.use("/auth", authRoutes);

// Simple health check -- useful for confirming the server is up at all,
// separate from any DB-dependent route.
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});