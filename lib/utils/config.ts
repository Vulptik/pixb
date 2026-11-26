/** Same-origin API path, including the configured API version. */
export const getApiUrlWithPort = (): string =>
  `/api/v${process.env.NEXT_PUBLIC_API_VERSION || '1'}`;
