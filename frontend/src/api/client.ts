import { ApiError, CLIENT_ERROR_CODES } from "./errors";

/**
 * The backend wraps every JSON response in this envelope. `data` has a
 * different shape per endpoint — usually a named key such as
 * `{ patient }` or `{ orders }`, but the dashboard puts its snapshot
 * directly in `data` — so callers name the shape with the type
 * parameter and the client never assumes one.
 */
export interface ApiEnvelope<T> {
  data: T;
  error: ApiErrorBody | null;
  meta: unknown;
}

interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Empty by default: requests go to same-origin relative URLs, which the
 * Vite dev proxy forwards to the backend (see vite.config.ts).
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Absolute-or-relative URL for a backend path such as
 * "/api/v1/patients". Query values that are null or undefined are
 * dropped. Use it directly when the browser itself must navigate to the
 * backend — e.g. opening the receipt print page in a new tab.
 */
export function apiUrl(path: string, query?: QueryParams): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  let url = `${API_BASE_URL}${normalizedPath}`;

  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) params.append(key, String(value));
    }
    const search = params.toString();
    if (search) url += `?${search}`;
  }
  return url;
}

async function send(method: Method, path: string, accept: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  try {
    return await fetch(apiUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: "include",
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, CLIENT_ERROR_CODES.ABORTED, "The request was cancelled.");
    }
    throw new ApiError(0, CLIENT_ERROR_CODES.NETWORK_ERROR, "Could not reach the server. Check your connection.");
  }
}

/** Parses a body as JSON, returning undefined when it is empty or not JSON. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return typeof value === "object" && value !== null && "data" in value && "error" in value;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiErrorBody).code === "string" &&
    typeof (value as ApiErrorBody).message === "string"
  );
}

/**
 * Builds the ApiError for a failed response. Uses the backend's error
 * envelope when present; otherwise (a proxy error page, an empty 502,
 * an envelope with `error: null` such as /health's 503) falls back to
 * a generic HTTP_ERROR carrying the status.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const payload = await readJson(response);
  if (isEnvelope(payload) && isErrorBody(payload.error)) {
    const { code, message, details } = payload.error;
    return new ApiError(response.status, code, message, details ?? null);
  }
  return new ApiError(
    response.status,
    CLIENT_ERROR_CODES.HTTP_ERROR,
    `Request failed with status ${response.status}.`
  );
}

/**
 * Sends a JSON request and returns the whole envelope's `data` and
 * `meta`. Use this when `meta` matters; otherwise use `request`.
 */
export async function requestEnvelope<T>(
  method: Method,
  path: string,
  options: RequestOptions = {}
): Promise<{ data: T; meta: unknown }> {
  const response = await send(method, path, "application/json", options);
  if (!response.ok) throw await toApiError(response);

  const payload = await readJson(response);
  if (!isEnvelope(payload)) {
    throw new ApiError(
      response.status,
      CLIENT_ERROR_CODES.INVALID_RESPONSE,
      "The server returned an unexpected response."
    );
  }
  if (isErrorBody(payload.error)) {
    // A 2xx carrying an error envelope is not expected from this API,
    // but it is still an error, never data.
    const { code, message, details } = payload.error;
    throw new ApiError(response.status, code, message, details ?? null);
  }
  return { data: payload.data as T, meta: payload.meta ?? null };
}

/** Sends a JSON request and returns the envelope's `data`, typed as T. */
export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await requestEnvelope<T>(method, path, options);
  return data;
}

/**
 * Fetches a non-JSON (e.g. text/html) endpoint and returns the body as
 * text. On failure the backend still answers with the JSON error
 * envelope, so errors surface as the same ApiError as everywhere else.
 * Used for GET /api/v1/receipts/invoices/:invoiceId/print.
 */
export async function requestText(path: string, options: Omit<RequestOptions, "body"> = {}): Promise<string> {
  const response = await send("GET", path, "text/html, text/plain;q=0.9, */*;q=0.8", options);
  if (!response.ok) throw await toApiError(response);
  return response.text();
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) => request<T>("GET", path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("POST", path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PATCH", path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("PUT", path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "body">) => request<T>("DELETE", path, options),
  getText: requestText,
  url: apiUrl,
};
