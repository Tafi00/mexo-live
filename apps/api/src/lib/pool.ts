/** Chạy fn cho từng phần tử với số luồng song song tối đa `concurrency`; lỗi từng phần tử không làm dừng cả lô */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      try {
        await fn(item);
      } catch (e) {
        console.error('[pool]', e);
      }
    }
  });
  await Promise.all(workers);
}
