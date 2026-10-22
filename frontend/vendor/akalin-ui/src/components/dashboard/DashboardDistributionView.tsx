/**
 * Akalin UI - DashboardDistributionView
 * Sağlayıcı bazlı oturum dağılımı veya Bölge bazlı proxy oranlarını yatay oran 
 * çubukları ve etiketlerle gösteren BaseDashboardView alt sınıfı.
 */
import React, { ReactNode } from 'react';
import BaseDashboardView, { BaseDashboardViewProps } from '../base/view/BaseDashboardView';

export interface DashboardDistributionItem {
    id: string;
    label: string;
    value: number | string;
    percentage: number;
    sublabel?: string;
    color?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
    badgeText?: string;
}

export interface DashboardDistributionViewProps extends BaseDashboardViewProps {
    /** Dağılım öğeleri dizisi */
    items: DashboardDistributionItem[];
    /** Yüzde gösterimini aç/kapat (varsayılan: true) */
    showPercentage?: boolean;
}

export default class DashboardDistributionView extends BaseDashboardView<DashboardDistributionViewProps> {

    static defaultProps = {
        emptyText: '-',
        showPercentage: true
    };

    protected renderBody(): ReactNode {
        const { 
            items = [], 
            showPercentage = true, 
            emptyText, 
            isLoading 
        } = this.props;

        if (isLoading) {
            return (
                <div className="base-dashboard-loading-skeleton">
                    <div className="skeleton-line" style={{ width: '100%', height: '24px' }} />
                    <div className="skeleton-line" style={{ width: '100%', height: '24px' }} />
                    <div className="skeleton-line" style={{ width: '100%', height: '24px' }} />
                </div>
            );
        }

        if (!items || items.length === 0) {
            return (
                <div className="dashboard-chart-empty">
                    {emptyText || 'Dağılım verisi bulunamadı'}
                </div>
            );
        }

        return (
            <div className="dashboard-distribution-list">
                {items.map((item) => {
                    const clampedPercent = Math.min(100, Math.max(0, item.percentage));
                    const colorClass = item.color || 'primary';

                    return (
                        <div key={item.id} className="dashboard-distribution-item">
                            <div className="distribution-item-header">
                                <div className="distribution-item-left">
                                    <span className="distribution-item-label" title={item.label}>
                                        {item.label}
                                    </span>
                                    {item.badgeText && (
                                        <span className={`distribution-item-badge badge-${colorClass}`}>
                                            {item.badgeText}
                                        </span>
                                    )}
                                    {item.sublabel && (
                                        <span className="distribution-item-sublabel">
                                            {item.sublabel}
                                        </span>
                                    )}
                                </div>

                                <div className="distribution-item-right">
                                    <span className="distribution-item-value">
                                        {item.value}
                                    </span>
                                    {showPercentage && (
                                        <span className="distribution-item-percent">
                                            %{clampedPercent}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="distribution-progress-track">
                                <div 
                                    className={`distribution-progress-bar bar-${colorClass}`} 
                                    style={{ width: `${clampedPercent}%` }}
                                    title={`%${clampedPercent}`}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }
}
