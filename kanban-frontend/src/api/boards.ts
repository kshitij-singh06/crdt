import { API_BASE_URL } from "../config";

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
  const res = await fetch(`${API_BASE_URL}/boards`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Fetch boards failed (${res.status})`);
  }
  return res.json();
}


export async function createBoard(name: string, token: string): Promise<{ board: { id: string; name: string } }> {
  const res = await fetch(`${API_BASE_URL}/boards`, {
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
  const res = await fetch(`${API_BASE_URL}/boards/${boardId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Delete board failed (${res.status})`);
  }
}

export async function getBoard(boardId: string, token: string): Promise<BoardDetail> {
  const res = await fetch(`${API_BASE_URL}/boards/${boardId}`, {
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
  const res = await fetch(`${API_BASE_URL}/boards/${boardId}/members`, {
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
  const res = await fetch(`${API_BASE_URL}/boards/${boardId}/columns`, {
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
  const res = await fetch(`${API_BASE_URL}/boards/${boardId}/columns/${columnId}/cards`, {
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

// ---------------------------------------------------------------------------
// Invite flow (Phase 4)
// ---------------------------------------------------------------------------

export interface InviteDetail {
  id: string;
  board_id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  token: string;
  created_at: string;
  accepted_at: string | null;
  board_name: string;
}

export async function createInvite(
  boardId: string,
  email: string,
  role: string,
  authToken: string
): Promise<{ invite: InviteDetail; inviteLink: string }> {
  const res = await fetch(`${API_BASE_URL}/boards/${boardId}/invites`, {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Create invite failed (${res.status})`);
  }
  return res.json();
}

export async function getInvite(
  inviteToken: string,
  authToken: string
): Promise<{ invite: InviteDetail }> {
  const res = await fetch(`${API_BASE_URL}/invites/${inviteToken}`, {
    headers: authHeaders(authToken),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Fetch invite failed (${res.status})`);
  }
  return res.json();
}

export async function acceptInvite(
  inviteToken: string,
  authToken: string
): Promise<{ message: string; boardId: string; role: string }> {
  const res = await fetch(`${API_BASE_URL}/invites/${inviteToken}/accept`, {
    method: "POST",
    headers: authHeaders(authToken),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Accept invite failed (${res.status})`);
  }
  return res.json();
}
