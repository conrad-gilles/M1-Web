/** Generic paginated response used by the tracks endpoint. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}
