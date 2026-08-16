const BASE = "http://localhost:4000";

export interface BoardMember {
  user_id: string;
  name: string;
  email: string;
  role: "owner" | "editor" | "viewer";
}

export interface RestColumn {
  id: string;
  title: string;
  position: number;
}

export interface RestCard {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  position: number;
}

export interface BoardDetail {
  board: { id: string; name: string; owner_id: string; created_at: string };
  members: BoardMember[];
  columns: RestColumn[];
  cards: RestCard[];
}

export interface BoardSummary {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role: "owner" | "editor" | "viewer";
}

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function getBoards(token: string): Promise<{ boards: BoardSummary[] }> {
  const res = await fetch(`${BASE}/boards`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Fetch boards failed (${res.status})`);
  }
  return res.json();
}


export async function createBoard(name: string, token: string): Promise<{ board: { id: string; name: string } }> {
  const res = await fetch(`${BASE}/boards`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Create board failed (${res.status})`);
  }
  return res.json();
}

export async function deleteBoard(boardId: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}/boards/${boardId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Delete board failed (${res.status})`);
  }
}

export async function getBoard(boardId: string, token: string): Promise<BoardDetail> {
  const res = await fetch(`${BASE}/boards/${boardId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Fetch board failed (${res.status})`);
  }
  return res.json();
}

export async function addMember(
  boardId: string,
  email: string,
  role: string,
  token: string
): Promise<void> {
  const res = await fetch(`${BASE}/boards/${boardId}/members`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Add member failed (${res.status})`);
  }
}

export async function createColumn(
  boardId: string,
  title: string,
  token: string
): Promise<RestColumn> {
  const res = await fetch(`${BASE}/boards/${boardId}/columns`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Create column failed (${res.status})`);
  }
  const data = await res.json();
  return data.column;
}

export async function createCard(
  boardId: string,
  columnId: string,
  title: string,
  token: string
): Promise<RestCard> {
  const res = await fetch(`${BASE}/boards/${boardId}/columns/${columnId}/cards`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Create card failed (${res.status})`);
  }
  const data = await res.json();
  return data.card;
}
