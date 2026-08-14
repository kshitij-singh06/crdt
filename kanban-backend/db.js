const { Pool } = require("pg");

// One shared connection pool for the whole app -- pg handles connection
// reuse/queuing internally, so you don't open a new DB connection per request.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = { pool };