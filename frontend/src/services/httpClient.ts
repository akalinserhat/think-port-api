/**
 * Tek sorumluluklu HTTP istemci yardımcıları.
 * Her fonksiyon yalnızca tek bir HTTP metodu veya hata ayrıştırma görevinden sorumludur.
 */

export async function extractHttpErrorMessage(res: Response): Promise<string> {
  try {
    const errJson = await res.json();
    return errJson.detail?.error?.message || errJson.detail || JSON.stringify(errJson);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function getJson<TResponse>(
  url: string,
  headers?: Record<string, string>
): Promise<TResponse> {
  const res = await fetch(url, {
    method: 'GET',
    headers,
  });
  if (!res.ok) {
    throw new Error(await extractHttpErrorMessage(res));
  }
  return res.json() as Promise<TResponse>;
}

export async function postJson<TRequest, TResponse>(
  url: string,
  payload?: TRequest,
  headers?: Record<string, string>
): Promise<TResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    throw new Error(await extractHttpErrorMessage(res));
  }
  return res.json() as Promise<TResponse>;
}

export async function patchJson<TRequest, TResponse>(
  url: string,
  payload?: TRequest,
  headers?: Record<string, string>
): Promise<TResponse> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    throw new Error(await extractHttpErrorMessage(res));
  }
  return res.json() as Promise<TResponse>;
}

export async function deleteJson<TResponse>(
  url: string,
  headers?: Record<string, string>
): Promise<TResponse> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    throw new Error(await extractHttpErrorMessage(res));
  }
  return res.json() as Promise<TResponse>;
}

export const httpClient = {
  get: getJson,
  post: <TResponse, TRequest = unknown>(
    url: string,
    payload?: TRequest,
    headers?: Record<string, string>
  ): Promise<TResponse> => postJson<TRequest, TResponse>(url, payload, headers),
  patch: <TResponse, TRequest = unknown>(
    url: string,
    payload?: TRequest,
    headers?: Record<string, string>
  ): Promise<TResponse> => patchJson<TRequest, TResponse>(url, payload, headers),
  delete: deleteJson,
};


