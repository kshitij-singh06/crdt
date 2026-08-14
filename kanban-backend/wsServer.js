require("dotenv").config();

const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { setupWSConnection } = require("y-websocket/bin/utils");
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

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const boardId = url.pathname.slice(1);

  // Hands off the now-authenticated, authorized socket to y-websocket's connection handler, which does the actual Yjs sync protocol work.
  setupWSConnection(ws, req, { docName: boardId, gc: true });
});

server.listen(PORT, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});