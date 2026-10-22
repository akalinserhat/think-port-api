/**
 * Akalin UI - DashboardActivityFeedView
 * Otomatik ölçeklenme, oturum hareketleri ve sistem olaylarını zaman çizelgesi 
 * (timeline feed) olarak listeleyen BaseDashboardView alt sınıfı.
 */
import React, { ReactNode } from 'react';
import BaseDashboardView, { BaseDashboardViewProps } from '../base/view/BaseDashboardView';

export interface DashboardActivityEvent {
    id: string;
    title: string;
    description?: string;
    timestamp: string;
    variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
    badgeText?: string;
    icon?: ReactNode;
}

export interface DashboardActivityFeedViewProps extends BaseDashboardViewProps {
    /** Zaman çizelgesi olayları dizisi */
    events: DashboardActivityEvent[];
    /** Gösterilecek maksimum olay sayısı (opsiyonel sınırlandırma) */
    maxItems?: number;
}

export default class DashboardActivityFeedView extends BaseDashboardView<DashboardActivityFeedViewProps> {

    static defaultProps = {
        emptyText: '-'
    };

    protected renderBody(): ReactNode {
        const { 
            events = [], 
            maxItems, 
            emptyText, 
            isLoading 
        } = this.props;

        if (isLoading) {
            return (
                <div className="base-dashboard-loading-skeleton">
                    <div className="skeleton-line" style={{ width: '90%', height: '32px' }} />
                    <div className="skeleton-line" style={{ width: '80%', height: '32px' }} />
                    <div className="skeleton-line" style={{ width: '85%', height: '32px' }} />
                </div>
            );
        }

        if (!events || events.length === 0) {
            return (
                <div className="dashboard-chart-empty">
                    {emptyText || 'Henüz bir aktivite kaydı bulunmuyor'}
                </div>
            );
        }

        const displayedEvents = typeof maxItems === 'number' && maxItems > 0 
            ? events.slice(0, maxItems) 
            : events;

        return (
            <div className="dashboard-activity-feed">
                {displayedEvents.map((evt, idx) => {
                    const variant = evt.variant || 'primary';
                    const isLast = idx === displayedEvents.length - 1;

                    return (
                        <div key={evt.id} className={`dashboard-activity-item item-${variant}`}>
                            <div className="activity-track">
                                <div className="activity-icon-node">
                                    {evt.icon || <span className="activity-node-pulse" />}
                                </div>
                                {!isLast && <div className="activity-line" />}
                            </div>

                            <div className="activity-details">
                                <div className="activity-head">
                                    <div className="activity-title-group">
                                        <span className="activity-title">{evt.title}</span>
                                        {evt.badgeText && (
                                            <span className={`activity-badge badge-${variant}`}>
                                                {evt.badgeText}
                                            </span>
                                        )}
                                    </div>
                                    <span className="activity-time">{evt.timestamp}</span>
                                </div>

                                {evt.description && (
                                    <div className="activity-desc">{evt.description}</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }
}
