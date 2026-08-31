function normalizeBaseUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL, "http://localhost:4000");
export const WS_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_WS_URL, "ws://localhost:4001");