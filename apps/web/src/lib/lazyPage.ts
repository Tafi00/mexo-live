import { createElement, lazy, type ComponentType } from 'react';

/**
 * Như React.lazy nhưng có preload(): khi code trang đã tải sẵn thì render ngay, không qua Suspense.
 * (React 19 giữ fallback tối thiểu ~300ms mỗi lần một thành phần lazy "treo", kể cả khi module đã có sẵn
 * → reload trang thấy vùng nội dung trống một nhịp rồi mới hiện.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<P extends Record<string, any>>(loader: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  const preload = () =>
    (pending ??= loader().then(
      (m) => {
        loaded = m.default;
        return m;
      },
      (e) => {
        pending = undefined;
        throw e;
      },
    ));
  const Lazy = lazy(preload);
  function Page(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy, props);
  }
  Page.preload = preload;
  return Page;
}
