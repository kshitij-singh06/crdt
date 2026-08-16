require("dotenv").config();

const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { setupWSConnection, getYDoc } = require("y-websocket/bin/utils");
const Y = require("yjs");
const { pool } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.WS_PORT || 4001;

// WHY setupWSConnection instead of writing the Yjs sync protocol by hand:
// Yjs's wire protocol (sync step 1/2, update messages, awareness messages)
// is nontrivial to get right, and y-websocket ships a reference
// implementation of exactly that protocol as `setupWSConnection`. Per the
// spec (Section 4), using the y-websocket reference provider server-side
// is an explicitly sanctioned option -- the actual custom engineering
// here is the AUTH layer wrapped around it, not reimplementing Yjs's sync
// algorithm from scratch. `docName` passed to setupWSConnection is the
// "room" key -- clients connecting with the same docName share the same
// Y.Doc state and receive each other's updates.
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server-side Yjs seeding
// ---------------------------------------------------------------------------

/**
 * Fetches the board snapshot from Postgres and writes it into `doc` inside a
 * single Yjs transaction. Called at most once per room lifetime — subsequent
 * connections reuse the already-populated in-memory doc.
 */
async function seedDocFromPostgres(doc, boardId) {
  const colResult = await pool.query(
    "SELECT id, title, position FROM column_ WHERE board_id = $1 ORDER BY position",
    [boardId]
  );
  const cardResult = await pool.query(
    "SELECT id, column_id, title, description, assignee_id, position FROM card WHERE board_id = $1 ORDER BY position",
    [boardId]
  );

  const columns = colResult.rows;
  const cards = cardResult.rows;

  if (columns.length === 0) return; // empty board — nothing to seed

  const columnsMap = doc.getMap("columns");
  const columnOrderArr = doc.getArray("columnOrder");
  const cardsMap = doc.getMap("cards");
  const cardOrderMap = doc.getMap("cardOrderByColumn");

  doc.transact(() => {
    for (const col of columns) {
      columnsMap.set(col.id, { id: col.id, title: col.title });
      columnOrderArr.push([col.id]);

      const colCards = cards
        .filter((c) => c.column_id === col.id)
        .sort((a, b) => a.position - b.position);

      const orderArr = new Y.Array();
      for (const card of colCards) {
        cardsMap.set(card.id, {
          id: card.id,
          columnId: card.column_id,
          title: card.title,
          description: card.description ?? "",
          assigneeId: card.assignee_id ?? null,
        });
        orderArr.push([card.id]);
      }
      cardOrderMap.set(col.id, orderArr);
    }
  });

  console.log(`[ws] Seeded room ${boardId} from Postgres (${columns.length} columns, ${cards.length} cards)`);
}

/**
 * Per-room lock: the first connection to call this sets an in-flight Promise
 * SYNCHRONOUSLY (before any await) so every subsequent connection that arrives
 * during the Postgres round-trip awaits the SAME promise instead of starting a
 * parallel seed. Once the seed resolves (or rejects), the lock is cleared so a
 * future server-restart scenario can re-seed cleanly.
 */
const seedingPromises = new Map(); // boardId -> in-flight seed Promise

async function seedDocFromPostgresOnce(doc, boardId) {
  // Fast path: doc already populated (subsequent connections after seed is done)
  if (doc.getArray("columnOrder").length > 0) return;

  // Lock already held: another connection is mid-seed — wait for it
  if (seedingPromises.has(boardId)) {
    await seedingPromises.get(boardId);
    return;
  }

  // We are the first — set the lock BEFORE the first await so any connection
  // arriving during the async Postgres call sees the lock already held.
  const seedPromise = seedDocFromPostgres(doc, boardId).finally(() => {
    seedingPromises.delete(boardId);
  });
  seedingPromises.set(boardId, seedPromise);
  await seedPromise;
}

const server = http.createServer();
const wss = new WebSocket.Server({ noServer: true });


// WHY we handle the WebSocket upgrade manually instead of just doing `new WebSocket.Server({ server })`:
// The default pattern accepts EVERY incoming connection at the WebSocket layer, with no way to reject before the handshake completes. We need to authenticate (valid JWT) and authorize (is this user a member of this board) BEFORE accepting the socket -- rejecting with a proper HTTP status code (401/403) at the upgrade stage, rather than accepting the connection and then just closing it, which is a worse signal for any client trying to distinguish "wrong password" from "network blip."
server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // The Yjs client (WebsocketProvider) connects to `${wsUrl}/${boardId}`,
    // so the room name arrives as the URL path -- strip the leading slash.
    const boardId = url.pathname.slice(1);
    const token = url.searchParams.get("token");

    if (!boardId || !token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const memberResult = await pool.query(
      "SELECT role FROM board_member WHERE board_id = $1 AND user_id = $2",
      [boardId, payload.userId]
    );

    if (memberResult.rows.length === 0) {
      // Not a member at all -- no read or write access to this board's room.
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const role = memberResult.rows[0].role;

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Stash the role on the socket itself. We're NOT yet using this to block writes -- viewers are intentionally allowed to connect and RECEIVE live updates (per spec Section 6, viewers see live state same as everyone else). Blocking a viewer's local mutations from being accepted server-side is Phase 4 work; this stash is what that future check will read.
      ws.userId = payload.userId;
      ws.role = role;
      wss.emit("connection", ws, request);
    });
  } catch (err) {
    console.error("WebSocket upgrade error:", err);
    socket.destroy();
  }
});

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const boardId = url.pathname.slice(1);

  // Seed the room's Y.Doc from Postgres exactly once, before the client
  // receives any sync messages. getYDoc() returns the same in-memory doc
  // instance that setupWSConnection will use, so writes here are immediately
  // visible to the connecting client during the sync handshake.
  const doc = getYDoc(boardId);
  await seedDocFromPostgresOnce(doc, boardId);

  // Hands off the now-seeded, authenticated socket to y-websocket's
  // connection handler for the actual Yjs sync protocol work.
  setupWSConnection(ws, req, { docName: boardId, gc: true });
});

server.listen(PORT, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});