/**
 * Akalin UI - DashboardStatCard
 * Kapasite ve KPI göstergeleri için BaseDashboardView temel sınıfından türetilen bileşen.
 */
import React, { ReactNode } from 'react';
import BaseDashboardView, { BaseDashboardViewProps } from '../base/view/BaseDashboardView';

export interface DashboardStatCardProps extends BaseDashboardViewProps {
    /** 0 - 100 arası doluluk / ilerleme yüzdesi */
    progress?: number;
    /** İlerleme çubuğu rengi (CSS değişkeni veya hex/rgb) */
    progressColor?: string;
    /** İkincil metrik etiketi (örn: "Kullanılan Kapasite", "Toplam Kota") */
    secondaryLabel?: string;
    /** İkincil metrik değeri (örn: "8 / 16 Oturum", "%50") */
    secondaryValue?: ReactNode;
}

export default class DashboardStatCard extends BaseDashboardView<DashboardStatCardProps> {

    protected renderBody(): ReactNode {
        const { 
            value, 
            subtitle, 
            subtitleColor, 
            emptyText, 
            isLoading,
            progress,
            progressColor,
            secondaryLabel,
            secondaryValue
        } = this.props;

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

        const hasProgress = typeof progress === 'number';
        const clampedProgress = hasProgress ? Math.min(100, Math.max(0, progress)) : 0;
        const hasSecondary = secondaryLabel !== undefined || secondaryValue !== undefined;

        return (
            <div className="base-dashboard-body">
                <div className="base-dashboard-value-row">
                    <div className="base-dashboard-value stat-value">{displayValue}</div>
                    {this.renderTrend()}
                </div>

                {hasProgress && (
                    <div className="dashboard-stat-progress-track" title={`%${clampedProgress}`}>
                        <div 
                            className="dashboard-stat-progress-fill" 
                            style={{ 
                                width: `${clampedProgress}%`,
                                backgroundColor: progressColor 
                            }} 
                        />
                    </div>
                )}

                {hasSecondary && (
                    <div className="dashboard-stat-secondary">
                        <span className="secondary-label">{secondaryLabel}</span>
                        <span className="secondary-value">{secondaryValue}</span>
                    </div>
                )}

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
}
