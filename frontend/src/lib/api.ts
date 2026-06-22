/**
 * API client: a thin fetch wrapper that attaches the bearer access token,
 * sends the refresh cookie, and transparently refreshes once on a 401.
 */
import { useAuthStore } from "../store/auth";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.access_token as string) ?? null;
  } catch {
    return null;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText || "Request failed";
  let code: string | undefined;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
    else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    code = body?.code;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, detail, code);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
}

async function request<T>(path: string, opts: RequestOptions = {}, allowRetry = true): Promise<T> {
  const { method = "GET", body, formData } = opts;
  const token = useAuthStore.getState().accessToken;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData; // browser sets multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload,
    credentials: "include",
  });

  if (res.status === 401 && allowRetry) {
    if (!refreshing) refreshing = doRefresh().finally(() => (refreshing = null));
    const newToken = await refreshing;
    if (newToken) {
      useAuthStore.getState().setAccessToken(newToken);
      return request<T>(path, opts, false);
    }
    useAuthStore.getState().reset();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", formData }),
};
