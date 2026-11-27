import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { ConfirmProvider } from '@/components/ui/dialog';
import { App } from './App';
import './index.css';

// Sau một bản deploy mới, chunk cũ không còn trên server → tải lại trang 1 lần để lấy bản mới (thay vì màn hình lỗi)
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('mexo-chunk-reload') === '1') return;
    sessionStorage.setItem('mexo-chunk-reload', '1');
  } catch {
    return;
  }
  e.preventDefault();
  window.location.reload();
});
setTimeout(() => {
  try {
    sessionStorage.removeItem('mexo-chunk-reload');
  } catch {
    /* bỏ qua */
  }
}, 15_000);

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <ConfirmProvider>
            <App />
            <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
          </ConfirmProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
