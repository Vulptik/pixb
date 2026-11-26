export type PagyMeta = {
  limit: number;
  count: number;
  page: number;
  pages: number;
};

export function buildPagy(count: number, page: number, limit: number): PagyMeta {
  const safeLimit = Math.max(1, limit);
  const safePage = Math.max(1, page);
  const pages = Math.max(1, Math.ceil(count / safeLimit));

  return {
    limit: safeLimit,
    count,
    page: safePage,
    pages,
  };
}
