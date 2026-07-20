// ponytail: single source for backend base URL; override via NEXT_PUBLIC_BACKEND_URL in production
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8001";
