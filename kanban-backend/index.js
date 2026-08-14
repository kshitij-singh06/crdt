require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authRoutes = require("./authRoutes");
const boardRoutes = require("./boardRoutes");

const app = express();

app.use(express.json());

app.use(cors());

app.use("/auth", authRoutes);
app.use("/boards", boardRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});