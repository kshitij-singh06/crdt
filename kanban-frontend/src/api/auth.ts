const BASE = "http://localhost:4000";

export interface AuthResponse {
  user: { user_id: string; name: string; email: string };
  token: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Login failed (${res.status})`);
  }
  return res.json();
}

export async function signup(
  name: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Signup failed (${res.status})`);
  }
  return res.json();
}
