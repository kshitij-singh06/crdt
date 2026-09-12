# Kanban Sync

A real-time collaborative Kanban board with live multi-user sync, offline support, and role-based access control.

Built with **React**, **Yjs CRDTs**, **WebSockets**, **Node.js/Express**, and **PostgreSQL**.

---

## Features

### Real-Time Collaboration
- **Live sync** — changes from any user appear instantly on all connected clients via Yjs CRDTs over WebSockets
- **Presence indicators** — see who's currently on the board with an avatar strip (Yjs Awareness protocol)
- **Editing awareness** — see which card a teammate is currently editing in real-time
- **Conflict-free** — Yjs CRDTs handle concurrent edits automatically (no last-write-wins data loss)

### Board Management
- **Drag-and-drop** — reorder cards within and across columns with smooth dnd-kit animations
- **Card detail view** — click any card to open a modal with title, description, assignee, and comments
- **Inline editing** — double-click card titles to edit them in-place
- **Per-card comments** — append-only threaded comments synced in real-time across all peers
- **Assignee management** — assign cards to any board member from a dropdown

### Offline Support
- **Offline editing** — continue creating columns, cards, and comments while disconnected
- **Automatic sync** — all offline changes merge seamlessly when you reconnect (CRDT merge, no conflicts)
- **IndexedDB persistence** — local state survives browser refreshes via `y-indexeddb`
- **Manual offline toggle** — test offline behavior with a single click ("Go Offline" button)

### Security & Access Control
- **JWT authentication** — signup/login with bcrypt-hashed passwords
- **Role-based access control (RBAC)** — three roles per board: `owner`, `editor`, `viewer`
- **Server-side enforcement** — viewer mutations are blocked at the WebSocket protocol level (Yjs SyncStep2/Update messages dropped), not just hidden in the UI
- **Token-based invites** — invite users by email with a shareable link; role assigned at invite time

---

## Architecture

```
┌──────────────┐     HTTP/REST      ┌───────────────────┐     SQL      ┌────────────┐
│              │ ──────────────────► │                   │ ──────────► │            │
│   React SPA  │                    │  Express REST API  │             │  PostgreSQL │
│   (Vite)     │     WebSocket      │   (port 4000)     │ ◄────────── │            │
│              │ ──────────────────► │                   │             └────────────┘
│              │                    └───────────────────┘
│              │     WebSocket      ┌───────────────────┐
│              │ ──────────────────► │  Yjs WebSocket    │
│              │  (Yjs sync +       │  Server            │
│              │   Awareness)       │   (port 4001)     │
└──────────────┘                    └───────────────────┘
       │
       │  IndexedDB
       ▼
  ┌──────────┐
  │ y-indexeddb│
  │ (offline) │
  └──────────┘
```

| Layer | Purpose |
|---|---|
| **REST API** | Auth, board/column CRUD, invite management, membership |
| **WebSocket Server** | Yjs document sync, Awareness (presence), RBAC enforcement at protocol level |
| **PostgreSQL** | Users, boards, columns, cards, invites, memberships |
| **Yjs Y.Doc** | Real-time collaborative state: card content, ordering, comments |
| **y-indexeddb** | Client-side persistence for offline support |

### Why both REST and Yjs?

- **Columns** are created via REST (so they persist in Postgres immediately) and seeded into the Yjs doc on WebSocket connection
- **Cards, card order, and comments** are managed purely through Yjs (real-time CRDT sync)
- This hybrid approach gives us the best of both: relational integrity for board structure + conflict-free real-time sync for content

---

## Project Structure

```
KANBAN/
├── kanban-backend/
│   ├── index.js              # Express REST API entry point
│   ├── wsServer.js           # Yjs WebSocket server + RBAC filter
│   ├── authRoutes.js         # POST /auth/signup, POST /auth/login
│   ├── boardRoutes.js        # CRUD for boards, columns, cards, members
│   ├── inviteRoutes.js       # Token-based invite create/accept flow
│   ├── authMiddleware.js     # JWT verification + role-check middleware
│   ├── db.js                 # PostgreSQL connection pool
│   ├── schema/
│   │   ├── schema.sql        # Core tables: users, board, board_member, board_column, card
│   │   └── 002_board_invite.sql  # Invite table migration
│   └── .env                  # DATABASE_URL, JWT_SECRET
│
├── kanban-frontend/
│   ├── src/
│   │   ├── hooks/
│   │   │   └── useYjsBoard.ts        # Yjs ↔ React binding (the hard part)
│   │   ├── components/
│   │   │   ├── BoardColumn.tsx        # Column with sortable card list
│   │   │   ├── KanbanCard.tsx         # Draggable card with inline edit
│   │   │   ├── CardDetailModal.tsx    # Card detail: description, assignee, comments
│   │   │   └── AddCardForm.tsx        # Inline card creation form
│   │   ├── pages/
│   │   │   ├── BoardPage.tsx          # Main board view with DnD, presence, detail modal
│   │   │   ├── BoardsPage.tsx         # Board list + create/delete
│   │   │   ├── InvitePage.tsx         # Invite acceptance flow
│   │   │   ├── LoginPage.tsx          # Login with redirect preservation
│   │   │   └── SignupPage.tsx         # Registration
│   │   ├── context/
│   │   │   └── AuthContext.tsx        # JWT token + user state
│   │   ├── api/
│   │   │   ├── auth.ts               # Login/signup API calls
│   │   │   └── boards.ts             # Board/column/card/invite API calls
│   │   ├── config.ts                 # API_BASE_URL, WS_BASE_URL from env
│   │   └── index.css                 # Full design system (~1400 lines)
│   └── package.json
│
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **PostgreSQL** >= 14
- **npm**

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/kanban-sync.git
cd kanban-sync
```

### 2. Set up the database

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE kanban;"

# Run schema migrations
psql -U postgres -d kanban -f kanban-backend/schema/schema.sql
psql -U postgres -d kanban -f kanban-backend/schema/002_board_invite.sql
```

### 3. Configure the backend

```bash
cd kanban-backend
npm install
```

Create a `.env` file:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/kanban
JWT_SECRET=your-secret-key-here
```

### 4. Configure the frontend

```bash
cd kanban-frontend
npm install
```

No `.env` needed for local development — defaults to `localhost:4000` (REST) and `localhost:4001` (WS).

### 5. Start everything

Open **three terminals**:

```bash
# Terminal 1 — REST API
cd kanban-backend
npm run dev          # -> http://localhost:4000

# Terminal 2 — WebSocket server
cd kanban-backend
npm run dev:ws       # -> ws://localhost:4001

# Terminal 3 — Frontend
cd kanban-frontend
npm run dev          # -> http://localhost:5173
```

### 6. Try it out

1. Open `http://localhost:5173` -> sign up with a new account
2. Create a board -> add columns -> add cards
3. Open a **second browser tab** (or incognito window) -> sign up as a different user
4. From the first tab, invite the second user to the board (Members panel -> Invite)
5. Open the invite link in the second tab -> accept -> both users are now on the same board
6. Edit cards, drag them around, add comments — changes appear in real-time on both tabs

---

## API Reference

### Authentication

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/auth/signup` | `{ name, email, password }` | Create account, returns JWT |
| `POST` | `/auth/login` | `{ email, password }` | Login, returns JWT |

### Boards

All board endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `GET` | `/boards` | — | List all boards you're a member of |
| `POST` | `/boards` | `{ name }` | Create a new board (you become owner) |
| `GET` | `/boards/:id` | — | Get board with members, columns, cards |
| `DELETE` | `/boards/:id` | — | Delete a board (owner only) |
| `POST` | `/boards/:id/members` | `{ email, role }` | Add a member directly |
| `POST` | `/boards/:id/columns` | `{ title }` | Create a column |

### Invites

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/boards/:id/invites` | `{ email, role }` | Create invite link |
| `GET` | `/invites/:token` | — | Look up invite details |
| `POST` | `/invites/:token/accept` | — | Accept invite (email must match) |

### WebSocket

Connect to `ws://localhost:4001/<boardId>?token=<jwt>` — handled automatically by `y-websocket`'s `WebsocketProvider`.

---

## RBAC Model

| Role | Read board | Edit cards | Drag cards | Add columns | Add comments | Manage members |
|---|---|---|---|---|---|---|
| **Owner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Editor** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Viewer** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

Viewer restrictions are enforced at **two layers**:
1. **Client-side** — mutation functions early-return with a warning; mutation UI is hidden
2. **Server-side** — the WebSocket server inspects Yjs protocol bytes and drops `SyncStep2`/`Update` messages from viewer connections before they reach the Y.Doc

This means even a compromised client cannot bypass viewer restrictions — the server silently drops the mutations.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Real-time sync | Yjs, y-websocket, y-indexeddb |
| Drag and drop | @dnd-kit/core, @dnd-kit/sortable |
| Routing | React Router v6 |
| Backend | Node.js, Express |
| Auth | JWT (jsonwebtoken), bcrypt |
| Database | PostgreSQL, pg |
| Styling | Vanilla CSS (dark theme, glassmorphism) |

---

## Deployment

The app can be deployed for free using:

| Service | Component |
|---|---|
| [Neon](https://neon.tech) | PostgreSQL (free 0.5 GB) |
| [Render](https://render.com) | REST API + WebSocket server (free tier) |
| [Vercel](https://vercel.com) | Frontend static hosting (free) |

Set these environment variables on Vercel:

```env
VITE_API_URL=https://your-api.onrender.com
VITE_WS_URL=wss://your-ws.onrender.com
```

---

## License

MIT
