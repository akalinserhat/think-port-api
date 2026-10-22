import React, { Component, ReactNode } from 'react';

export interface BaseFormatterViewProps {
    value?: any;
    className?: string;
    style?: React.CSSProperties;
    icon?: ReactNode;
    emptyText?: string;
}

/**
 * BaseFormatterView
 * Diğer View bileşenlerinin (PhoneView, IbanView vb.) miras alacağı (Inheritance)
 * temel OOP Sınıf (Class) bileşenidir.
 */
export default class BaseFormatterView<P extends BaseFormatterViewProps = BaseFormatterViewProps, S = {}> extends Component<P, S> {
    
    static defaultProps = {
        emptyText: '-'
    };

    /**
     * Alt sınıfların (Child classes) miras alıp override (ezebileceği) 
     * ederek kendi veri formatlama mantıklarını kuracağı metot.
     */
    protected formatValue(val: any): string | ReactNode {
        return String(val);
    }

    render() {
        const { value, className, style, icon, emptyText } = this.props;
        
        // Değer varsa alt sınıfın (veya base'in) formatValue fonksiyonunu çağır
        const displayValue = value !== undefined && value !== null && value !== '' ? this.formatValue(value) : emptyText;

        return (
            <div 
                className={`base-view flex-row items-center gap-8 ${className || ''}`} 
                style={style}
            >
                {icon && (
                    <span className="view-icon flex-row items-center text-secondary">
                        {icon}
                    </span>
                )}
                <span className={`view-value font-medium text-primary ${this.constructor.name === 'IbanView' ? 'font-mono' : ''}`}>
                    {displayValue}
                </span>
            </div>
        );
    }
}
