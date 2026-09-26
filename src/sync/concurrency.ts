/** Bounded concurrency map — polite to CourseLink. */
export async function mapLimit<T, R>(
  list: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  };
  const n = Math.min(Math.max(1, limit), Math.max(1, list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
