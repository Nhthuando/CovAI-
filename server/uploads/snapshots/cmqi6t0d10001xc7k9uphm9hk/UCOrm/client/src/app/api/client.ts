type StoredUser = {
  name?: string | null;
  email?: string | null;
};

type AuthInfo = {
  token: string;
  name: string;
  email: string;
};

type ApiPlace = {
  id: string;
  google_place_id: string;
  name?: string | null;
};

type ApiReview = {
  id: string;
  place_id: string;
  author_name?: string | null;
  rating?: number | null;
  text?: string | null;
  status?: string | null;
  created_at?: string | null;
  published_at?: string | null;
  approved_reply_id?: string | null;
};

type ApiReply = {
  id: string;
  type: string;
  content: string;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  skipAuth?: boolean;
};

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'ucorm_token';    
const USER_KEY = 'ucorm_user';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setAuth(auth: AuthInfo) {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, JSON.stringify({ name: auth.name, email: auth.email }));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!options.skipAuth) {
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await response.text();
  const data = rawText ? safeJsonParse(rawText) : null;

  if (!response.ok) {
    if (!options.skipAuth && (response.status === 401 || response.status === 403)) {
      // Token expired or invalid: clear client auth and force re-login.
      clearAuth();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    const message =
      (data && typeof data === 'object' && 'message' in data && data.message) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(String(message), response.status, data);
  }

  return data as T;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<AuthInfo> {
  return request<AuthInfo>('/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuth: true,
  });
}

export async function register(name: string, email: string, password: string) {
  return request<{ message: string; user?: { name?: string; email?: string } }>(
    '/auth/register',
    {
      method: 'POST',
      body: { name, email, password },
      skipAuth: true,
    }
  );
}

export async function getPlaces() {
  return request<{ place: ApiPlace[] }>('/places');
}

export async function addPlace(ggPlaceId: string) {
  return request<{ place: ApiPlace }>('/places/addPlaces', {
    method: 'POST',
    body: { ggPlaceId },
  });
}

export async function getPlaceReviews(placeId: string) {
  return request<{ reviews: ApiReview[] }>(`/places/${placeId}/reviews`);
}

export async function fetchReviews(placeId: string) {
  return request<{ savedReviews: ApiReview[] }>(`/places/${placeId}/fetch-reviews`);
}

export async function generateAIReplies(reviewId: string) {
  const data = await request<{ reply?: ApiReply[]; existReply?: ApiReply[] }>(
    `/reviews/${reviewId}/generate`,
    {
      method: 'POST',
    }
  );
  return data.reply || data.existReply || [];
}

export async function getAIReplies(reviewId: string) {
  const data = await request<{ reply: ApiReply[] }>(`/reviews/${reviewId}/reply`);
  return data.reply;
}

export async function approveReview(reviewId: string, AIReplyId: string) {
  return request(`/reviews/${reviewId}/approve`, {
    method: 'POST',
    body: { AIReplyId },
  });
}

export type { ApiPlace, ApiReview, ApiReply, StoredUser, AuthInfo };
