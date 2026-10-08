// Typed calls for Admin → API keys (/api/admin/api-keys). Admins only ever see a key's prefix, never the key.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthedApi } from './tx';

export type KeyStatus = 'pending' | 'active' | 'paused' | 'rejected' | 'revoked';
export type KeyTier = 'free' | 'partner';
export type KeyCounts = Record<KeyStatus | 'all', number>;

export interface ApiKeyRow {
  id: string; address: string; project: string; use_case: string; website: string | null; has_contact: boolean;
  status: KeyStatus; tier: KeyTier; per_minute: number; per_day: number; prefix: string | null;
  reject_reason: string | null; admin_note: string | null; usage_today: number;
  created_at: string; updated_at: string; approved_at: string | null; approved_by: string | null; rejected_at: string | null; rejected_by: string | null;
  revealed_at: string | null; rotated_at: string | null; revoked_at: string | null; revoked_by: string | null; last_used_at: string | null;
}
export interface ApiKeyDetail extends ApiKeyRow { contact: string | null; contact_unreadable: boolean }
export interface KeySettings { defaults: { per_minute: number; per_day: number }; caps: { per_minute: number; per_day: number }; max_keys: number }
export interface LimitsBody { per_minute?: number; per_day?: number; tier?: KeyTier; note?: string }

export function useApiKeys(status: KeyStatus | '', q: string) {
  const authed = useAuthedApi();
  return useQuery({
    queryKey: ['admin-api-keys', status, q],
    queryFn: () => authed.get<{ keys: ApiKeyRow[]; counts: KeyCounts } & KeySettings>('/admin/api-keys', { status, q }),
    placeholderData: (p) => p,
    refetchInterval: 30_000,
  });
}

export function useApiKey(id: string | null) {
  const authed = useAuthedApi();
  return useQuery({
    queryKey: ['admin-api-key', id],
    queryFn: () => authed.get<{ key: ApiKeyDetail; usage: { day: string; requests: number }[] } & KeySettings>(`/admin/api-keys/${id}`),
    enabled: !!id,
    staleTime: 15_000,
    retry: false,
  });
}

/** Requests waiting for review (the nav badge). */
export function usePendingApiKeys(enabled: boolean) {
  const authed = useAuthedApi();
  return useQuery({
    queryKey: ['admin-api-keys-summary'],
    queryFn: () => authed.get<{ counts: KeyCounts }>('/admin/api-keys/summary'),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useApiKeyActions() {
  const authed = useAuthedApi();
  const qc = useQueryClient();
  const done = <T,>(p: Promise<T>) => p.finally(() => {
    qc.invalidateQueries({ queryKey: ['admin-api-keys'] });
    qc.invalidateQueries({ queryKey: ['admin-api-key'] });
    qc.invalidateQueries({ queryKey: ['admin-api-keys-summary'] });
  });
  return {
    approve: (id: string, body: LimitsBody) => done(authed.post<{ key: ApiKeyRow }>(`/admin/api-keys/${id}/approve`, body)),
    reject: (id: string, reason: string) => done(authed.post<{ key: ApiKeyRow }>(`/admin/api-keys/${id}/reject`, { reason })),
    move: (id: string, action: 'pause' | 'resume' | 'revoke') => done(authed.post<{ key: ApiKeyRow }>(`/admin/api-keys/${id}/${action}`, {})),
    update: (id: string, body: LimitsBody) => done(authed.patch<{ key: ApiKeyRow }>(`/admin/api-keys/${id}`, body)),
  };
}
