/**
 * ThinkPort API - Yönetici Giriş Bileşeni (LoginView.tsx)
 * Merkezi @akalin/user_auth_module paketindeki UserAuthLoginPage bileşenini kullanarak
 * sistem kullanıcılarının kimlik doğrulama, e-posta ile şifre sıfırlama, tema/dil değişimi
 * ve varsayılan yönetici hızlı giriş akışlarını yürütür.
 */

import React from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UserAuthLoginPage } from '@akalin/user_auth_module';
import { useTheme } from '../context/ThemeContext';
import { SystemUserRecordDTO } from '../dtos';
import { smtpService, systemUserService } from '../services';

export interface LoginViewProps {
  onLoginSuccess: (user: SystemUserRecordDTO) => void;
}

const THINKPORT_AGENT_EMAIL = 'akalinserhat@gmail.com';
const THINKPORT_AGENT_PASSWORD = '190300';

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  return (
    <UserAuthLoginPage
      title={t('login.title', 'ThinkPort API')}
      subtitle={t(
        'login.subtitle',
        'Admin Yönetim Paneline devam etmek için sistem kullanıcısı bilgilerinizle giriş yapın.'
      )}
      brandIcon={<Sparkles size={26} />}
      submitText={t('login.submit', 'Admin Panele Giriş Yap')}
      submittingText={t('login.submitting', 'Giriş Yapılıyor...')}
      emailLabel={t('login.email_label', 'E-posta Adresi')}
      emailPlaceholder={THINKPORT_AGENT_EMAIL}
      passwordLabel={t('login.password_label', 'Şifre')}
      passwordPlaceholder="••••••"
      rememberEmailKey="thinkport_remembered_email"
      rememberFlagKey="thinkport_remember_me"
      showRememberMe={true}
      showPasswordToggle={true}
      showLanguageToggle={true}
      showThemeToggle={true}
      theme={theme}
      onToggleTheme={toggleTheme}
      forgotPasswordText={t('login.forgot_password', 'Şifremi Unuttum (E-posta ile Sıfırla)')}
      agentCredentials={{
        email: THINKPORT_AGENT_EMAIL,
        password: THINKPORT_AGENT_PASSWORD,
        panelTitle: t('login.agent_panel_title', 'Serhat Akalın (Varsayılan Yönetici)'),
        statusLabel: t('login.agent_ready', 'Hazır'),
        quickLoginText: t('login.agent_quick_login', 'Hızlı Giriş Yap'),
        fillFormText: t('login.agent_fill_form', 'Forma Doldur')
      }}
      onLogin={async ({ email, password }) => {
        try {
          const res = await systemUserService.login({
            email: email.trim(),
            password: password.trim()
          });
          onLoginSuccess(res.user);
          return { success: true };
        } catch (err) {
          return {
            success: false,
            message: err instanceof Error ? err.message : t('login.error_generic', 'Giriş yapılamadı.')
          };
        }
      }}
      onForgotPassword={async (email) => {
        const res = await smtpService.sendPasswordResetEmail({
          email: email.trim(),
          apply_temporary_password: true
        });
        return {
          message: `${res.email} adresine şifre sıfırlama e-postası gönderildi.${
            res.temporary_password ? ` Geçici Şifreniz: ${res.temporary_password}` : ''
          }`,
          temporaryPassword: res.temporary_password ?? undefined
        };
      }}
      footerNote={
        <>
          <Lock size={13} />
          <span>
            {t(
              'login.footer_note',
              'Sistem Kullanıcıları yalnızca yetkili yöneticiler tarafından /settings/users üzerinden yönetilir.'
            )}
          </span>
        </>
      }
    />
  );
};

export default LoginView;
