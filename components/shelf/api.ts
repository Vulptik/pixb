export class ShelfApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public items?: unknown,
    message?: string,
  ) {
    super(message || code);
  }
}
export async function shelfApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ShelfApiError(
      body.code || 'requestFailed',
      response.status,
      body.items,
      body.message,
    );
  return body as T;
}
