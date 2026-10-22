/**
 * Akalin UI - DashboardTimelineChartView
 * Zaman serisi verilerini harici kütüphane gerektirmeden saf ve duyarlı (responsive) 
 * SVG Area / Line / Bar grafiği olarak çizen BaseDashboardView alt sınıfı.
 */
import React, { ReactNode } from 'react';
import BaseDashboardView, { BaseDashboardViewProps } from '../base/view/BaseDashboardView';

export interface DashboardTimelineChartSeries {
    key: string;
    label: string;
    color?: string;
    type?: 'area' | 'line' | 'bar';
}

export interface DashboardTimelineChartViewProps extends BaseDashboardViewProps {
    /** Çizilecek zaman serisi veri dizisi */
    data: Array<Record<string, any>>;
    /** X ekseninde kullanılacak zaman / etiket alanı (örn: 'time_label') */
    xKey: string;
    /** Çizilecek veri serileri listesi */
    series: DashboardTimelineChartSeries[];
    /** Kapasite veya üst sınır referans çizgisi */
    maxY?: number;
    /** Grafik SVG yüksekliği (varsayılan: 220) */
    height?: number;
    /** Seri lejantını göster / gizle (varsayılan: true) */
    showLegend?: boolean;
    /** Izgara çizgilerini göster / gizle (varsayılan: true) */
    showGrid?: boolean;
}

const DEFAULT_SERIES_COLORS = [
    '#6366f1', // Indigo / Accent Primary
    '#10b981', // Emerald / Success
    '#f59e0b', // Amber / Warning
    '#3b82f6', // Blue / Info
    '#ec4899', // Pink
    '#8b5cf6'  // Purple
];

export default class DashboardTimelineChartView extends BaseDashboardView<DashboardTimelineChartViewProps> {

    static defaultProps = {
        emptyText: '-',
        height: 220,
        showLegend: true,
        showGrid: true
    };

    private chartUid = `chart_${Math.random().toString(36).substring(2, 9)}`;

    /**
     * Düzgün yumuşatılmış kübik bezier (cubic bezier) SVG path string üretir.
     */
    private generateSmoothPath(points: Array<{ x: number; y: number }>): string {
        if (!points || points.length === 0) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

        let path = `M ${points[0].x} ${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const cpX1 = p0.x + (p1.x - p0.x) / 2;
            const cpY1 = p0.y;
            const cpX2 = p0.x + (p1.x - p0.x) / 2;
            const cpY2 = p1.y;
            path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
        }
        return path;
    }

    protected renderBody(): ReactNode {
        const { 
            data = [], 
            xKey, 
            series = [], 
            maxY, 
            height = 220, 
            showLegend = true, 
            showGrid = true, 
            emptyText,
            isLoading 
        } = this.props;

        if (isLoading) {
            return (
                <div className="base-dashboard-loading-skeleton">
                    <div className="skeleton-line" style={{ width: '100%', height: `${height}px` }} />
                </div>
            );
        }

        if (!data || data.length === 0) {
            return (
                <div className="dashboard-chart-empty">
                    {emptyText || 'Görüntülenecek veri bulunamadı'}
                </div>
            );
        }

        // 1. Maksimum Değer ve Ölçekleme Hesaplama
        let computedMax = 0;
        data.forEach(item => {
            series.forEach(s => {
                const val = Number(item[s.key]) || 0;
                if (val > computedMax) computedMax = val;
            });
        });

        if (maxY !== undefined && maxY > computedMax) {
            computedMax = maxY;
        }

        if (computedMax === 0) computedMax = 10;
        // Tavana yuvarlama (örn: 12 -> 14, 85 -> 100)
        const scaleMax = Math.ceil(computedMax * 1.15) || 10;

        // 2. SVG Koordinat ve Boyut Alanları
        const svgWidth = 600;
        const padding = { top: 22, right: 24, bottom: 32, left: 38 };
        const innerWidth = svgWidth - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;

        const getX = (idx: number) => {
            if (data.length <= 1) return padding.left + innerWidth / 2;
            return padding.left + (idx / (data.length - 1)) * innerWidth;
        };

        const getY = (val: number) => {
            const clamped = Math.max(0, Math.min(scaleMax, val));
            return padding.top + innerHeight - (clamped / scaleMax) * innerHeight;
        };

        // 3. Yatay Kılavuz Çizgileri (Grid) ve Y Eksen Etiketleri
        const gridSteps = [0, 0.33, 0.66, 1];
        const gridLines = gridSteps.map((pct) => {
            const val = Math.round(pct * scaleMax);
            const y = getY(val);
            return { val, y };
        });

        // 4. Kapasite Çizgisi (maxY)
        const capacityY = maxY !== undefined ? getY(maxY) : null;

        // 5. X Ekseni Etiketleri (Aşırı kalabalığı önleme adımı)
        const step = Math.max(1, Math.ceil(data.length / 7));
        const xLabels = data.map((d, i) => {
            const shouldShow = i === 0 || i === data.length - 1 || i % step === 0;
            return {
                text: String(d[xKey] ?? ''),
                x: getX(i),
                shouldShow
            };
        });

        return (
            <div className="dashboard-chart-container">
                {/* Seri Lejantı */}
                {showLegend && (
                    <div className="dashboard-chart-legend">
                        {series.map((s, idx) => {
                            const color = s.color || DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length];
                            return (
                                <div key={s.key} className="dashboard-chart-legend-item">
                                    <span className="legend-indicator" style={{ backgroundColor: color }} />
                                    <span>{s.label}</span>
                                </div>
                            );
                        })}

                        {maxY !== undefined && (
                            <div className="dashboard-chart-legend-item legend-capacity">
                                <span className="legend-indicator" style={{ backgroundColor: 'var(--danger, #ef4444)' }} />
                                <span>Kapasite Sınırı ({maxY})</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Saf SVG Zaman Serisi Çizimi */}
                <svg
                    viewBox={`0 0 ${svgWidth} ${height}`}
                    className="dashboard-chart-svg"
                    preserveAspectRatio="xMidYMid meet"
                >
                    <defs>
                        {series.map((s, idx) => {
                            const color = s.color || DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length];
                            const gradId = `chart-grad-${this.chartUid}-${s.key}`;
                            return (
                                <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={color} stopOpacity="0.32" />
                                    <stop offset="100%" stopColor={color} stopOpacity="0.01" />
                                </linearGradient>
                            );
                        })}
                    </defs>

                    {/* Izgara Çizgileri & Y Etiketleri */}
                    {showGrid && gridLines.map((g, idx) => (
                        <g key={idx}>
                            <line
                                x1={padding.left}
                                y1={g.y}
                                x2={padding.left + innerWidth}
                                y2={g.y}
                                stroke="var(--glass-border, rgba(0, 0, 0, 0.08))"
                                strokeDasharray={idx === 0 ? undefined : '3 3'}
                                strokeWidth="1"
                            />
                            <text
                                x={padding.left - 8}
                                y={g.y + 3.5}
                                textAnchor="end"
                                fill="var(--text-secondary, #9ca3af)"
                                fontSize="10"
                                fontFamily="inherit"
                            >
                                {g.val}
                            </text>
                        </g>
                    ))}

                    {/* Kapasite Sınır Çizgisi (maxY) */}
                    {capacityY !== null && (
                        <g>
                            <line
                                x1={padding.left}
                                y1={capacityY}
                                x2={padding.left + innerWidth}
                                y2={capacityY}
                                stroke="var(--danger, #ef4444)"
                                strokeDasharray="4 3"
                                strokeWidth="1.5"
                                opacity="0.85"
                            />
                            <text
                                x={padding.left + innerWidth}
                                y={capacityY - 5}
                                textAnchor="end"
                                fill="var(--danger, #ef4444)"
                                fontSize="9.5"
                                fontWeight="600"
                                fontFamily="inherit"
                            >
                                Kapasite ({maxY})
                            </text>
                        </g>
                    )}

                    {/* Veri Serileri Çizimi */}
                    {series.map((s, idx) => {
                        const color = s.color || DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length];
                        const type = s.type || 'area';
                        const gradId = `chart-grad-${this.chartUid}-${s.key}`;

                        const points = data.map((d, dIdx) => ({
                            x: getX(dIdx),
                            y: getY(Number(d[s.key]) || 0),
                            val: Number(d[s.key]) || 0,
                            label: String(d[xKey] ?? '')
                        }));

                        const linePath = this.generateSmoothPath(points);
                        const bottomY = padding.top + innerHeight;
                        const areaPath = points.length > 1
                            ? `${linePath} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`
                            : '';

                        if (type === 'bar') {
                            const barWidth = Math.max(4, Math.min(24, (innerWidth / data.length) * 0.45));
                            return (
                                <g key={s.key}>
                                    {points.map((p, pIdx) => {
                                        const barH = bottomY - p.y;
                                        return (
                                            <rect
                                                key={pIdx}
                                                x={p.x - barWidth / 2}
                                                y={p.y}
                                                width={barWidth}
                                                height={Math.max(0, barH)}
                                                rx="3"
                                                fill={color}
                                                opacity="0.88"
                                            >
                                                <title>{`${s.label}: ${p.val} (${p.label})`}</title>
                                            </rect>
                                        );
                                    })}
                                </g>
                            );
                        }

                        return (
                            <g key={s.key}>
                                {/* Area Dolgusu */}
                                {type === 'area' && areaPath && (
                                    <path
                                        d={areaPath}
                                        fill={`url(#${gradId})`}
                                    />
                                )}

                                {/* Çizgi */}
                                <path
                                    d={linePath}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />

                                {/* Noktalar */}
                                {points.map((p, pIdx) => (
                                    <circle
                                        key={pIdx}
                                        cx={p.x}
                                        cy={p.y}
                                        r="3"
                                        fill="#ffffff"
                                        stroke={color}
                                        strokeWidth="2"
                                    >
                                        <title>{`${s.label}: ${p.val} (${p.label})`}</title>
                                    </circle>
                                ))}
                            </g>
                        );
                    })}

                    {/* X Ekseni Zaman Etiketleri */}
                    {xLabels.map((lbl, idx) => {
                        if (!lbl.shouldShow) return null;
                        return (
                            <text
                                key={idx}
                                x={lbl.x}
                                y={height - 10}
                                textAnchor="middle"
                                fill="var(--text-secondary, #9ca3af)"
                                fontSize="10"
                                fontFamily="inherit"
                            >
                                {lbl.text}
                            </text>
                        );
                    })}
                </svg>
            </div>
        );
    }
}
