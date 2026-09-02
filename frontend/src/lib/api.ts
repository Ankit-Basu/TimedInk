import type {
  AuthUser,
  CreateEmailInput,
  DeliverabilityPreview,
  EmailStatus,
  Mailbox,
  Paginated,
  ScheduledEmail,
  ScheduledEmailDetail,
  StatusCounts,
} from './types';

/**
 * Thin typed wrapper over fetch.
 *
 * An empty base URL means "same origin", which is what the Vite dev proxy
 * gives us — so there is no CORS preflight on every dashboard poll.
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

const TOKEN_STORAGE_KEY = 'timedink.token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      // Private mode / storage disabled — the app still works, just without a
      // remembered session.
      return null;
    }
  },
  set: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** An error carrying the API's structured shape, so the UI can act on `status`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages from zod, flattened for display under a form. */
  get fieldMessages(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter(
        (d): d is { path: string; message: string } =>
          typeof d === 'object' && d !== null && 'message' in d,
      )
      .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message));
  }
}

/**
 * Every response body is `{ data: ... }`, and list responses add a sibling
 * `pagination`. `requestRaw` returns the whole envelope; `request` unwraps the
 * common case.
 */
async function requestRaw<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const hasBody = init.body !== undefined;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    // Network-level failure (API down, DNS, offline). Give the UI something
    // actionable rather than a bare TypeError.
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is the backend running?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const body = parsed as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? response.statusText,
      body.error?.details,
    );
  }

  return parsed as T;
}

const request = <T>(path: string, init?: RequestInit): Promise<T> =>
  requestRaw<{ data: T }>(path, init).then((body) => body.data);

function emailQuery(params: {
  status?: EmailStatus | EmailStatus[];
  page?: number;
  pageSize?: number;
  q?: string;
}): string {
  const search = new URLSearchParams();
  if (params.status) {
    const value = Array.isArray(params.status) ? params.status.join(',') : params.status;
    if (value) search.set('status', value);
  }
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  return search.toString();
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export const api = {
  // --- auth ----------------------------------------------------------------

  register: (email: string, password: string, name: string) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  // --- emails --------------------------------------------------------------

  /** Returns the full envelope: list responses carry `pagination` alongside `data`. */
  listEmails: (params: {
    status?: EmailStatus | EmailStatus[];
    page?: number;
    pageSize?: number;
    q?: string;
  }) => requestRaw<Paginated<ScheduledEmail>>(`/api/emails?${emailQuery(params)}`),

  emailStats: () => request<StatusCounts>('/api/emails/stats'),

  getEmail: (id: string) => request<ScheduledEmailDetail>(`/api/emails/${id}`),

  createEmail: (input: CreateEmailInput) =>
    request<ScheduledEmail>('/api/emails', { method: 'POST', body: JSON.stringify(input) }),

  cancelEmail: (id: string) => request<ScheduledEmail>(`/api/emails/${id}`, { method: 'DELETE' }),

  previewScore: (subject: string, body: string) =>
    request<DeliverabilityPreview>('/api/emails/preview-score', {
      method: 'POST',
      body: JSON.stringify({ subject, body }),
    }),

  // --- mailboxes -----------------------------------------------------------

  listMailboxes: () => request<Mailbox[]>('/api/mailboxes'),

  advanceWarmup: (id: string, days = 1) =>
    request<Mailbox>(`/api/mailboxes/${id}/advance-warmup`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
};
