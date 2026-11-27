import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, Role } from '@mexo/shared';
import { api, ApiError, setUnauthorizedHandler } from './api';

export interface Me {
  user: {
    id: number;
    username: string;
    name: string;
    email: string | null;
    role: Role;
    permissions: Permission[];
    mustChangePassword: boolean;
    parentId: number | null;
    owner: { serviceExpiresOn: string | null; shopLimit: number | null } | null;
  };
  system: { frozen: boolean; freezeReason: string | null; shopeeMode: 'mock' | 'sandbox' | 'live' };
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  can: (p: Permission) => boolean;
  isStaff: boolean;
  isSysadmin: boolean;
  role: Role | null;
}

const Ctx = createContext<AuthCtx>({ me: null, loading: true, refresh: async () => {}, can: () => false, isStaff: false, isSysadmin: false, role: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
    });
  }, [qc]);
  const me = q.data ?? null;
  const role = me?.user.role ?? null;
  return (
    <Ctx.Provider
      value={{
        me,
        loading: q.isLoading,
        refresh: () => q.refetch(),
        can: (p) => Boolean(me?.user.permissions.includes(p)),
        isStaff: role === 'sysadmin' || role === 'admin',
        isSysadmin: role === 'sysadmin',
        role,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
