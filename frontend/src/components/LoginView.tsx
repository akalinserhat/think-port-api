import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  LogIn,
  Eye,
  EyeOff,
  Sparkles,
  Sun,
  Moon,
  AlertCircle,
  UserCheck,
  Mail,
  CheckCircle2,
} from 'lucide-react';
import { BaseButton, BaseInput, EmailInput } from '@akalin/ui';
import { useTheme } from '../context/ThemeContext';
import { SystemUserRecordDTO } from '../dtos';
import { smtpService, systemUserService } from '../services';

interface LoginViewProps {
  onLoginSuccess: (user: SystemUserRecordDTO) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState('akalinserhat@gmail.com');
  const [password, setPassword] = useState('190300');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Lütfen e-posta adresinizi ve şifrenizi girin.');
      return;
    }

    setLoading(true);
    try {
      const res = await systemUserService.login({
        email: email.trim(),
        password: password.trim(),
      });
      onLoginSuccess(res.user);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Giriş yapılamadı.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Şifre sıfırlama e-postası için lütfen e-posta adresinizi girin.');
      return;
    }
    setSendingReset(true);
    try {
      const res = await smtpService.sendPasswordResetEmail({
        email: cleanEmail,
        apply_temporary_password: true,
      });
      setSuccessMsg(
        `${res.email} adresine şifre sıfırlama e-postası gönderildi.${
          res.temporary_password ? ` Geçici Şifreniz: ${res.temporary_password}` : ''
        }`
      );
      if (res.temporary_password) {
        setPassword(res.temporary_password);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Şifre sıfırlama e-postası gönderilemedi.'
      );
    } finally {
      setSendingReset(false);
    }
  };

  const handleFillDefault = () => {
    setEmail('akalinserhat@gmail.com');
    setPassword('190300');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background:
          theme === 'dark'
            ? 'radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.16), transparent 45%), radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.10), transparent 45%), var(--md-sys-color-surface, #111318)'
            : 'radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.10), transparent 45%), radial-gradient(circle at 80% 80%, rgba(59, 91, 169, 0.08), transparent 45%), var(--md-sys-color-surface, #f9f9ff)',
        position: 'relative',
      }}
    >
      {/* Sağ Üst Tema Değiştirici */}
      <div style={{ position: 'fixed', top: '20px', right: '24px', zIndex: 10 }}>
        <BaseButton
          variant="outline"
          className="btn-sm"
          icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          text={theme === 'dark' ? 'Aydınlık Tema' : 'Karanlık Tema'}
          onClick={toggleTheme}
        />
      </div>

      {/* Login Kartı */}
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          background: 'var(--md-sys-color-surface-container-lowest, var(--surface-primary, #ffffff))',
          border: '1px solid var(--md-sys-color-outline-variant, var(--glass-border))',
          borderRadius: '20px',
          padding: '36px 32px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.14)',
        }}
      >
        {/* Marka & Başlık */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            marginBottom: '28px',
          }}
        >
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #4f46e5 0%, #3b5ba9 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
              boxShadow: '0 8px 20px rgba(79, 70, 229, 0.32)',
            }}
          >
            <Sparkles size={26} />
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: '21px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            ThinkPort API
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '13px',
              color: 'var(--text-secondary)',
            }}
          >
            Admin Yönetim Paneline devam etmek için sistem kullanıcısı bilgilerinizle giriş yapın.
          </p>
        </div>

        {/* Hata Mesajı */}
        {errorMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 14px',
              marginBottom: '18px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--danger, #ef4444)',
              fontSize: '12.5px',
              fontWeight: 600,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Başarı Mesajı */}
        {successMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 14px',
              marginBottom: '18px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: 'var(--success, #10b981)',
              fontSize: '12.5px',
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Giriş Formu */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <EmailInput
            label="E-posta Adresi"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="akalinserhat@gmail.com"
            required
          />

          <div style={{ position: 'relative' }}>
            <BaseInput
              label="Şifre"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              title={showPassword ? 'Şifreyi Gizle' : 'Şifreyi Göster'}
              style={{
                position: 'absolute',
                right: '12px',
                bottom: '10px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px',
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-6px' }}>
            <button
              type="button"
              disabled={sendingReset}
              onClick={handleForgotPassword}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--primary)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 0',
              }}
            >
              <Mail size={13} />
              <span>
                {sendingReset ? 'E-posta Gönderiliyor...' : 'Şifremi Unuttum (E-posta ile Sıfırla)'}
              </span>
            </button>
          </div>

          <div style={{ marginTop: '4px' }}>
            <BaseButton
              type="submit"
              variant="primary"
              icon={<LogIn size={16} />}
              text={loading ? 'Giriş Yapılıyor...' : 'Admin Panele Giriş Yap'}
              loading={loading}
              style={{ width: '100%', height: '42px', justifyContent: 'center', fontWeight: 600 }}
            />
          </div>
        </form>

        {/* Varsayılan Sistem Kullanıcısı Bilgi Kartı */}
        <div
          onClick={handleFillDefault}
          title="Bilgileri forma doldurmak için tıklayın"
          style={{
            marginTop: '24px',
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'var(--surface-secondary)',
            border: '1px dashed var(--glass-border)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(79, 70, 229, 0.14)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <UserCheck size={16} />
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                Serhat Akalın (Varsayılan Yönetici)
              </div>
              <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '11.5px' }}>
                akalinserhat@gmail.com · Şifre: 190300
              </div>
            </div>
          </div>
          <ShieldCheck size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
        </div>
      </div>

      {/* Alt Bilgi */}
      <div
        style={{
          marginTop: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}
      >
        <Lock size={13} />
        <span>Sistem Kullanıcıları yalnızca yetkili yöneticiler tarafından /settings/users üzerinden yönetilir.</span>
      </div>
    </div>
  );
};
