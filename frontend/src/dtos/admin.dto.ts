export interface AIModelDTO {
  id: string;
  name: string;
  vendor: string;
  provider: string;
  badge: string;
  description: string;
  is_local?: boolean;
  is_image?: boolean;
  image_model?: string;
  web_model?: string;
  fallback_local?: string;
}

export interface UserTokenUsageItemDTO {
  id: string;
  source: 'studio' | 'api' | string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

export interface UserTokenDateGroupDTO {
  usage_date: string;
  request_count: number;
  studio_tokens: number;
  api_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  items: UserTokenUsageItemDTO[];
}

export interface UserTokenAllocationDTO {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  token_amount: number;
  used_tokens: number;
  remaining_tokens: number;
  usage_percent: number;
  description?: string;
  created_at?: string;
  updated_at?: string;
  date_groups: UserTokenDateGroupDTO[];
}

export interface TokenAllocationInputDTO {
  id?: string;
  start_date: string;
  end_date: string;
  token_amount: number;
  description?: string;
}

export interface UserRecordDTO {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user' | string;
  status: 'active' | 'suspended';
  token_quota: number;
  tokens_used: number;
  rpm_limit: number;
  concurrent_limit: number;
  created_at: string;
}

export interface CreateUserRequestDTO {
  email: string;
  full_name: string;
  role?: string;
  status?: 'active' | 'suspended';
  token_quota: number;
  rpm_limit: number;
  token_allocations?: TokenAllocationInputDTO[];
}

export interface SystemUserRecordDTO {
  id: string;
  full_name: string;
  email: string;
  password?: string;
  role: string;
  status: 'active' | 'suspended';
  last_login_at?: string | null;
  created_at: string;
}

export interface CreateSystemUserRequestDTO {
  full_name: string;
  email: string;
  password: string;
  role?: string;
  status?: 'active' | 'suspended';
  token_quota?: number;
  rpm_limit?: number;
  token_allocations?: TokenAllocationInputDTO[];
}

export interface UpdateSystemUserRequestDTO {
  full_name?: string;
  email?: string;
  password?: string;
  role?: string;
  status?: 'active' | 'suspended';
  token_quota?: number;
  rpm_limit?: number;
  token_allocations?: TokenAllocationInputDTO[];
}

export interface SystemUserLoginRequestDTO {
  email: string;
  password: string;
}

export interface SystemUserLoginResponseDTO {
  authenticated: boolean;
  user: SystemUserRecordDTO;
  token: string;
  error?: string;
}

export interface ApiKeyRecordDTO {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  raw_preview?: string;
  is_active: boolean;
  expires_at: string;
  created_at?: string;
}

export interface CreateApiKeyRequestDTO {
  user_id: string;
  name: string;
  expires_in_days: number;
  api_key?: string;
}

export interface CreateApiKeyResponseDTO {
  api_key: string;
  record: ApiKeyRecordDTO;
}

export interface BrowserSessionDTO {
  id: string;
  provider: string;
  account: string;
  proxy: string;
  status: 'idle' | 'busy' | string;
  requests_served: number;
  is_dynamic?: boolean;
  created_at?: string;
  last_active_at?: string;
  idle_ttl_sec?: number;
}

export interface CreateBrowserSessionRequestDTO {
  provider: string;
  account?: string;
  proxy_id?: string;
  idle_ttl_sec?: number;
}

export interface ProxyNodeDTO {
  id: string;
  protocol: 'http' | 'https' | 'socks5' | 'socks4' | string;
  endpoint: string;
  country: string;
  city?: string;
  proxy_type?: 'residential' | 'mobile' | 'isp' | 'datacenter' | string;
  provider?: string;
  latency_ms?: number;
  status: 'active' | 'cooldown' | string;
  fails: number;
}

export interface CreateProxyRequestDTO {
  protocol: string;
  endpoint: string;
  country: string;
  city: string;
  proxy_type: string;
  provider: string;
}

export interface BulkProxyImportRequestDTO {
  raw_list: string;
  default_protocol: string;
  default_country: string;
  default_type: string;
  default_provider: string;
}

export interface FetchFreeProxyRequestDTO {
  protocol: string;
  limit: number;
}

export interface BulkProxyResponseDTO {
  added_count: number;
  added: ProxyNodeDTO[];
}

import { ConversationSummaryDTO } from './chat.dto';

export interface UsageLogDTO {
  request_id: string;
  conversation_id?: string;
  user_email: string;
  model: string;
  session_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  is_stream: boolean;
  latency_ms: number;
  ttft_ms?: number;
  status?: 'success' | 'error' | string;
  upstream_provider?: string;
  prompt_preview?: string;
  response_preview?: string;
  attachment_names?: string[];
  error_detail?: string;
  created_at: string;
}

export interface GatewaySettingsDTO {
  global_rpm: number;
  max_concurrent_browsers: number;
  keep_alive_interval_sec: number;
  enable_stealth: boolean;
  auto_rotate_proxy_on_403: boolean;
}

export interface RolePermissionDTO {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  is_admin_panel_allowed: boolean;
  permissions: string[];
  assigned_user_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateRolePermissionRequestDTO {
  name: string;
  description?: string;
  is_admin_panel_allowed?: boolean;
  permissions?: string[];
}

export interface UpdateRolePermissionRequestDTO {
  name?: string;
  description?: string;
  is_admin_panel_allowed?: boolean;
  permissions?: string[];
}

export type {
  EmailTemplateDTO,
  SmtpConfigDTO as SmtpSettingsDTO,
} from '@akalin/email_module';

export interface PasswordResetLogDTO {
  id: string;
  user_id?: string | null;
  email: string;
  full_name: string;
  reset_token: string;
  reset_url: string;
  temporary_password?: string | null;
  delivery_status: string;
  delivery_detail: string;
  expires_at: string;
  used_at?: string | null;
  created_at: string;
}

export interface SendPasswordResetRequestDTO {
  email?: string;
  user_id?: string;
  apply_temporary_password?: boolean;
  custom_message?: string;
}

export interface SendPasswordResetResponseDTO {
  ok: boolean;
  status: string;
  detail: string;
  email: string;
  full_name: string;
  reset_token: string;
  reset_url: string;
  temporary_password?: string | null;
  expires_at: string;
  log_id: string;
}

export interface ConfirmPasswordResetRequestDTO {
  reset_token?: string;
  email?: string;
  new_password: string;
}

export interface PoolTimelinePointDTO {
  id: string;
  timestamp_iso: string;
  time_label: string;
  total_sessions: number;
  active_busy_sessions: number;
  idle_sessions: number;
  warm_sessions: number;
  dynamic_sessions: number;
  max_capacity: number;
  active_proxies: number;
  cooldown_proxies: number;
  avg_proxy_latency_ms: number;
  requests_per_min: number;
}

export interface PoolScalingEventDTO {
  id: string;
  event_type: 'autoscale_up' | 'autoscale_down' | 'manual_spawn' | 'session_terminated' | 'proxy_cooldown' | string;
  session_id: string;
  provider: string;
  proxy_endpoint: string;
  detail: string;
  total_sessions_after: number;
  created_at: string;
}

export interface ProviderPoolStatDTO {
  provider: string;
  total_sessions: number;
  busy_sessions: number;
  idle_sessions: number;
  warm_sessions: number;
  dynamic_sessions: number;
  requests_served: number;
  share_pct: number;
}

export interface ProxyRegionStatDTO {
  country: string;
  total_proxies: number;
  active_proxies: number;
  avg_latency_ms: number;
}

export interface PoolDashboardSummaryDTO {
  total_sessions: number;
  max_capacity: number;
  utilization_pct: number;
  busy_sessions: number;
  idle_sessions: number;
  warm_sessions: number;
  dynamic_sessions: number;
  total_requests_served: number;
  active_proxies: number;
  cooldown_proxies: number;
  avg_proxy_latency_ms: number;
  autoscale_events_24h: number;
}

export interface PoolDashboardMetricsDTO {
  summary: PoolDashboardSummaryDTO;
  timeline: PoolTimelinePointDTO[];
  provider_distribution: ProviderPoolStatDTO[];
  proxy_region_distribution: ProxyRegionStatDTO[];
  recent_events: PoolScalingEventDTO[];
}

export interface AdminStateResponseDTO {
  models: AIModelDTO[];
  users: UserRecordDTO[];
  api_keys: ApiKeyRecordDTO[];
  browser_sessions: BrowserSessionDTO[];
  proxies: ProxyNodeDTO[];
  usage_logs: UsageLogDTO[];
  conversations?: ConversationSummaryDTO[];
  system_logs?: string[];
  settings: GatewaySettingsDTO;
  pool_dashboard?: PoolDashboardMetricsDTO;
}

export type ActiveTab = 'chat' | 'overview' | 'users' | 'keys' | 'nodes' | 'settings';
export type ThemeMode = 'light' | 'dark';
export type SupportedLanguage = 'tr' | 'en';
