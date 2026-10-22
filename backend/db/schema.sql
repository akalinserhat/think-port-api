-- ============================================================================
-- PostgreSQL Database Schema: AI Browser Automation Gateway & SaaS Platform
-- Clean Code Edition: Tablolar + Tek Görevli Fonksiyonlar (Functions) ve Prosedürler (Procedures)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. KULLANICILAR VE KREDİ/TOKEN LİMİTLERİ (Users & Quotas)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(150),
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    
    -- Kredi ve Token Kotası
    token_quota BIGINT NOT NULL DEFAULT 100000,       -- Toplam tanımlanan token limiti
    tokens_used BIGINT NOT NULL DEFAULT 0,            -- Şu ana kadar harcanan token
    concurrent_limit INT NOT NULL DEFAULT 2,          -- Aynı anda çalışabilecek maksimum istek
    rpm_limit INT NOT NULL DEFAULT 20,                -- Dakikadaki maksimum istek sayısı (Rate Limit)
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. API ANAHTARLARI (API Keys - Bearer Tokens)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,                       -- Örn: "Production Key", "Test App"
    key_prefix VARCHAR(16) NOT NULL,                  -- Görüntüleme için önek: "sk-proj-a1b2..."
    key_hash VARCHAR(64) UNIQUE NOT NULL,             -- SHA-256 hash (güvenlik için düz metin tutulmaz)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,                           -- NULL ise süresiz
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- 3. PROXY HAVUZU (Proxy Pool Management)
CREATE TABLE proxies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol VARCHAR(10) NOT NULL DEFAULT 'http' CHECK (protocol IN ('http', 'https', 'socks5', 'socks4')),
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    username VARCHAR(150),
    password_encrypted TEXT,
    country_code VARCHAR(5),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cooldown', 'dead')),
    fail_count INT NOT NULL DEFAULT 0,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TARAYICI OTURUMLARI (Warm Browser Sessions & Accounts)
CREATE TABLE browser_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,                    -- Örn: 'chatgpt-web', 'claude-web', 'deepseek-web'
    account_identifier VARCHAR(255) NOT NULL,         -- Hesap e-postası veya etiketi
    proxy_id UUID REFERENCES proxies(id) ON DELETE SET NULL,
    
    -- Çerezler, LocalStorage ve Fingerprint verileri (Playwright storage_state formatı)
    storage_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_agent TEXT,
    
    status VARCHAR(30) NOT NULL DEFAULT 'idle' 
        CHECK (status IN ('idle', 'busy', 'warming_up', 'cf_challenge', 'rate_limited', 'expired')),
    
    cooldown_until TIMESTAMPTZ,                       -- Rate limit yemişse ne zamana kadar bekleyecek
    total_requests_served BIGINT NOT NULL DEFAULT 0,
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_browser_sessions_provider_status ON browser_sessions(provider, status);

-- 5. KULLANIM LOGLARI VE İSTATİSTİKLER (Usage & Audit Logs)
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    browser_session_id UUID REFERENCES browser_sessions(id) ON DELETE SET NULL,
    
    request_id VARCHAR(64) UNIQUE NOT NULL,           -- "chatcmpl-..."
    model VARCHAR(64) NOT NULL,
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    
    latency_ms INT,                                   -- Toplam yanıt süresi
    ttft_ms INT,                                      -- İlk token süresi (Time-To-First-Token)
    is_stream BOOLEAN NOT NULL DEFAULT FALSE,
    status_code INT NOT NULL DEFAULT 200,
    error_message TEXT,
    client_ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_logs_user_created ON usage_logs(user_id, created_at DESC);

-- 6. SİSTEM GENEL AYARLARI (Global System Settings)
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description) VALUES
('global_rate_limit', '{"rpm": 600, "max_concurrent_browsers": 20}', 'Sistem genel istek ve eşzamanlı tarayıcı sınırları'),
('session_health', '{"keep_alive_interval_sec": 300, "max_Dom_wait_sec": 90}', 'Tarayıcı sekmelerini canlı tutma ve timeout ayarları'),
('anti_bot_config', '{"enable_stealth": true, "auto_rotate_proxy_on_403": true}', 'Cloudflare ve anti-bot koruma politikaları');

-- 6.1 BAĞLANTI HAVUZU ZAMAN SERİSİ METRİKLERİ (Connection Pool Time-Series Snapshots)
CREATE TABLE pool_metrics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    time_label VARCHAR(16) NOT NULL,
    total_sessions INT NOT NULL DEFAULT 0,
    active_busy_sessions INT NOT NULL DEFAULT 0,
    idle_sessions INT NOT NULL DEFAULT 0,
    warm_sessions INT NOT NULL DEFAULT 0,
    dynamic_sessions INT NOT NULL DEFAULT 0,
    max_capacity INT NOT NULL DEFAULT 16,
    active_proxies INT NOT NULL DEFAULT 0,
    cooldown_proxies INT NOT NULL DEFAULT 0,
    avg_proxy_latency_ms INT NOT NULL DEFAULT 0,
    requests_per_min INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_pool_metrics_snapshots_ts ON pool_metrics_snapshots(timestamp_iso DESC);

-- 6.2 BAĞLANTI HAVUZU ÖLÇEKLENME VE YAŞAM DÖNGÜSÜ OLAYLARI (Pool Scaling & Lifecycle Events)
CREATE TABLE pool_scaling_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(40) NOT NULL,
    session_id VARCHAR(64) NOT NULL DEFAULT '',
    provider VARCHAR(50) NOT NULL DEFAULT '',
    proxy_endpoint VARCHAR(255) NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    total_sessions_after INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pool_scaling_events_created ON pool_scaling_events(created_at DESC);

-- ============================================================================
-- 7. TEK GÖREVLİ VERİTABANI FONKSİYONLARI (Single-Responsibility SQL Functions)
-- ============================================================================

-- Fonksiyon 1: Kullanıcının yeterli token kotası olup olmadığını kontrol eder (Salt Okunur)
CREATE OR REPLACE FUNCTION fn_has_available_quota(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_has_quota BOOLEAN;
BEGIN
    SELECT (status = 'active' AND tokens_used < token_quota)
    INTO v_has_quota
    FROM users
    WHERE id = p_user_id;

    RETURN COALESCE(v_has_quota, FALSE);
END;
$$;

-- Fonksiyon 2: API anahtarının aktif ve süresinin dolmamış olduğunu doğrular (Salt Okunur)
CREATE OR REPLACE FUNCTION fn_is_api_key_valid(p_key_hash VARCHAR(64))
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_valid BOOLEAN;
BEGIN
    SELECT (is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()))
    INTO v_valid
    FROM api_keys
    WHERE key_hash = p_key_hash;

    RETURN COALESCE(v_valid, FALSE);
END;
$$;

-- Fonksiyon 3: Belirtilen sağlayıcı için en az istek sunmuş boşta (idle) oturumun ID'sini bulur
CREATE OR REPLACE FUNCTION fn_find_least_loaded_idle_session(p_provider VARCHAR(50))
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_session_id UUID;
BEGIN
    SELECT id
    INTO v_session_id
    FROM browser_sessions
    WHERE provider = p_provider
      AND status = 'idle'
    ORDER BY total_requests_served ASC
    LIMIT 1;

    RETURN v_session_id;
END;
$$;

-- ============================================================================
-- 8. TEK GÖREVLİ VERİTABANI PROSEDÜRLERİ (Single-Responsibility Stored Procedures)
-- ============================================================================

-- Prosedür 1: Kullanıcının harcadığı token miktarını atomik olarak artırır
CREATE OR REPLACE PROCEDURE pr_increment_user_tokens(
    p_user_id UUID,
    p_token_delta BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE users
    SET tokens_used = tokens_used + GREATEST(0, p_token_delta),
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;

-- Prosedür 2: Tarayıcı oturumunu 'busy' olarak kilitler
CREATE OR REPLACE PROCEDURE pr_acquire_browser_session(
    p_session_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE browser_sessions
    SET status = 'busy',
        last_active_at = NOW()
    WHERE id = p_session_id;
END;
$$;

-- Prosedür 3: Tarayıcı oturumunu 'idle' durumuna döndürür ve sayacı artırır
CREATE OR REPLACE PROCEDURE pr_release_browser_session(
    p_session_id UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE browser_sessions
    SET status = 'idle',
        total_requests_served = total_requests_served + 1,
        last_active_at = NOW()
    WHERE id = p_session_id;
END;
$$;

-- Prosedür 4: Proxy hata sayısını artırır; eşik aşılırsa 'cooldown' durumuna alır
CREATE OR REPLACE PROCEDURE pr_record_proxy_failure(
    p_proxy_id UUID,
    p_cooldown_threshold INT DEFAULT 3
)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE proxies
    SET fail_count = fail_count + 1,
        status = CASE
            WHEN fail_count + 1 >= p_cooldown_threshold THEN 'cooldown'
            ELSE status
        END,
        last_checked_at = NOW()
    WHERE id = p_proxy_id;
END;
$$;

-- Prosedür 5: Tek bir API kullanım kaydını (Usage Log) tabloya ekler
CREATE OR REPLACE PROCEDURE pr_insert_usage_log(
    p_user_id UUID,
    p_api_key_id UUID,
    p_browser_session_id UUID,
    p_request_id VARCHAR(64),
    p_model VARCHAR(64),
    p_prompt_tokens INT,
    p_completion_tokens INT,
    p_latency_ms INT,
    p_is_stream BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO usage_logs (
        user_id,
        api_key_id,
        browser_session_id,
        request_id,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        latency_ms,
        is_stream
    ) VALUES (
        p_user_id,
        p_api_key_id,
        p_browser_session_id,
        p_request_id,
        p_model,
        p_prompt_tokens,
        p_completion_tokens,
        p_prompt_tokens + p_completion_tokens,
        p_latency_ms,
        p_is_stream
    );
END;
$$;
