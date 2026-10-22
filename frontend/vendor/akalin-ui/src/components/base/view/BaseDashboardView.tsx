/**
 * Akalin UI - Temel Dashboard Görünüm Sınıfı (BaseDashboardView)
 * Dashboard içindeki istatistik, özet veri ve kartların (widget) miras alacağı
 * veya doğrudan kullanacağı temel OOP Sınıf (Class) bileşenidir.
 */
import React, { Component, ReactNode, CSSProperties } from 'react';
import '../../dashboard/BaseDashboardView.css';

export interface BaseDashboardViewProps {
    title: string;
    value?: any;
    subtitle?: string;
    subtitleColor?: string;
    icon?: ReactNode;
    className?: string;
    style?: CSSProperties;
    emptyText?: string;

    // Vurgu ve Kart Varyantı
    variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

    // Başlık Yanı Rozet / Etiket
    badge?: ReactNode;

    // Sağ Üst Eylem / Filtre / Menü Alanı
    headerExtra?: ReactNode;

    // Artış / Azalış Trend Göstergesi
    trend?: {
        value: string | number;
        direction: 'up' | 'down' | 'neutral';
        label?: string;
    };

    // Kart Alt Bilgi Alanı
    footer?: ReactNode;

    // Yüklenme Durumu
    isLoading?: boolean;

    // Tıklanabilirlik Eylemi
    onClick?: () => void;
}

export default class BaseDashboardView<
    P extends BaseDashboardViewProps = BaseDashboardViewProps,
    S = {}
> extends Component<P, S> {
    
    static defaultProps = {
        emptyText: '-'
    };

    /**
     * Alt sınıfların (Child classes) miras alıp override (ezebileceği) 
     * ederek kendi veri formatlama mantıklarını kuracağı metot.
     */
    protected formatValue(val: any): any {
        return String(val);
    }

    /**
     * Başlık, ikon, rozet (badge) ve headerExtra alanını render eden şablon metot.
     * Alt sınıflar bu metodu override ederek başlık alanını özelleştirebilir.
     */
    protected renderHeader(): ReactNode {
        const { title, icon, badge, headerExtra } = this.props;

        return (
            <div className="base-dashboard-header">
                <div className="base-dashboard-title-group">
                    {icon && (
                        <div className="base-dashboard-icon">
                            {icon}
                        </div>
                    )}
                    <div className="base-dashboard-title-wrap">
                        <span className="base-dashboard-title stat-title">{title}</span>
                        {badge && (
                            <span className="base-dashboard-badge">
                                {badge}
                            </span>
                        )}
                    </div>
                </div>

                {headerExtra && (
                    <div className="base-dashboard-header-extra">
                        {headerExtra}
                    </div>
                )}
            </div>
        );
    }

    /**
     * Trend göstergesi (artış, azalış veya nötr ok) render eden yardımcı metot.
     */
    protected renderTrend(): ReactNode {
        const { trend } = this.props;
        if (!trend) return null;

        const { value, direction, label } = trend;
        const dirClass = direction === 'up' ? 'trend-up' : direction === 'down' ? 'trend-down' : 'trend-neutral';
        const symbol = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';

        return (
            <div className={`base-dashboard-trend ${dirClass}`}>
                <span className="base-dashboard-trend-icon">{symbol}</span>
                <span className="base-dashboard-trend-val">{value}</span>
                {label && <span className="base-dashboard-trend-label">{label}</span>}
            </div>
        );
    }

    /**
     * Varsayılan gövde: Değer (stat-value), trend ve alt başlık (subtitle) render eder.
     * Grafik veya liste alt sınıfları bu metodu override ederek kendi SVG veya liste içeriklerini render eder.
     */
    protected renderBody(): ReactNode {
        const { value, subtitle, subtitleColor, emptyText, isLoading } = this.props;

        if (isLoading) {
            return (
                <div className="base-dashboard-loading-skeleton">
                    <div className="skeleton-line skeleton-value" />
                    <div className="skeleton-line skeleton-subtitle" />
                </div>
            );
        }

        const displayValue = value !== undefined && value !== null && value !== '' 
            ? this.formatValue(value) 
            : emptyText;

        return (
            <div className="base-dashboard-body">
                <div className="base-dashboard-value-row">
                    <div className="base-dashboard-value stat-value">{displayValue}</div>
                    {this.renderTrend()}
                </div>

                {subtitle && (
                    <div 
                        className="base-dashboard-subtitle" 
                        style={{ color: subtitleColor || 'var(--text-secondary, #6b7280)' }}
                    >
                        {subtitle}
                    </div>
                )}
            </div>
        );
    }

    /**
     * Varsa alt bilgi (footer) alanını render eden şablon metot.
     */
    protected renderFooter(): ReactNode {
        const { footer } = this.props;
        if (!footer) return null;

        return (
            <div className="base-dashboard-footer">
                {footer}
            </div>
        );
    }

    render() {
        const { className, style, variant = 'default', onClick } = this.props;
        const isClickable = typeof onClick === 'function';
        const variantClass = variant && variant !== 'default' ? `variant-${variant}` : '';
        const clickableClass = isClickable ? 'is-clickable' : '';

        return (
            <div 
                className={`surface-card base-dashboard-view ${variantClass} ${clickableClass} ${className || ''}`} 
                style={style}
                onClick={onClick}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
            >
                {this.renderHeader()}
                {this.renderBody()}
                {this.renderFooter()}
            </div>
        );
    }
}
