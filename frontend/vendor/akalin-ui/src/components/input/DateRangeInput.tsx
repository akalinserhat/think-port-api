/**
 * Akalin UI - Tarih Aralığı Seçici Giriş Bileşeni (DateRangeInput.tsx)
 * 
 * Başlıca Görevleri:
 * - Başlangıç ve bitiş tarihlerini aralık (range) şeklinde görsel olarak seçtirmek
 * - Popover takvim açılır penceresi üzerinden ay ve gün navigasyonu sağlamak
 * - Form doğrulama (DocumentFormContext) ve hata durumlarını yönetmek
 */

import React, { forwardRef, useContext, useRef, useImperativeHandle, useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import FieldError from '../common/FieldError';
import { DocumentFormContext } from '../../pages/base/BaseDocumentPage';

export interface DateRangeInputProps {
    id?: string;
    startDate?: string;
    endDate?: string;
    baslangicTarihi?: string;
    bitisTarihi?: string;
    onChange?: (startDate: string, endDate: string) => void;
    startName?: string;
    endName?: string;
    baslangicName?: string;
    bitisName?: string;
    disabled?: boolean;
    required?: boolean;
    placeholderStart?: string;
    placeholderEnd?: string;
    placeholderBaslangic?: string;
    placeholderBitis?: string;
    errorStart?: boolean;
    errorEnd?: boolean;
    errorBaslangic?: boolean;
    errorBitis?: boolean;
    className?: string;
    autoFocus?: boolean;
}

export type TarihAraligiSeciciProps = DateRangeInputProps;

const normalizeDate = (dateStr?: string | null): string => {
    if (!dateStr) return '';
    let s = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    s = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
    }
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
        const [d, m, y] = s.split('.');
        return `${y}-${m}-${d}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [d, m, y] = s.split('/');
        return `${y}-${m}-${d}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    return s;
};

const DateRangeInput = forwardRef<any, DateRangeInputProps>(({
    id = 'dateRangeInput',
    startDate,
    endDate,
    baslangicTarihi,
    bitisTarihi,
    onChange,
    startName,
    endName,
    baslangicName = 'baslangicTarihi',
    bitisName = 'bitisTarihi',
    disabled,
    required,
    placeholderStart,
    placeholderEnd,
    placeholderBaslangic,
    placeholderBitis,
    errorStart,
    errorEnd,
    errorBaslangic,
    errorBitis,
    className = '',
    autoFocus = false,
}, ref) => {
    const { t, i18n } = useTranslation();
    const formContext = (useContext as any)(DocumentFormContext);
    const formErrors = formContext?.errors;

    const actualStartDate = startDate !== undefined ? startDate : baslangicTarihi;
    const actualEndDate = endDate !== undefined ? endDate : bitisTarihi;
    const actualStartName = startName || baslangicName;
    const actualEndName = endName || bitisName;

    const [isOpen, setIsOpen] = useState(false);
    const [viewDate, setViewDate] = useState<Date>(() => {
        const s = normalizeDate(actualStartDate);
        if (s) {
            const [y, m, d] = s.split('-').map(Number);
            if (y && m) return new Date(y, m - 1, d || 1);
        }
        return new Date();
    });

    const containerRef = useRef<HTMLDivElement>(null);

    // Sync viewDate when startDate changes
    useEffect(() => {
        const s = normalizeDate(actualStartDate);
        if (s) {
            const [y, m, d] = s.split('-').map(Number);
            if (y && m) {
                setViewDate(new Date(y, m - 1, d || 1));
            }
        }
    }, [actualStartDate]);

    // Forward ref to allow parent components to programmatically open/focus the calendar
    useImperativeHandle(ref, () => ({
        focus: () => {
            if (!disabled) {
                setIsOpen(true);
            }
        }
    }));

    // Handle outside clicks to close the calendar popover
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // Handle autoFocus property
    useEffect(() => {
        if (autoFocus && !disabled) {
            setIsOpen(true);
        }
    }, [autoFocus, disabled]);

    const baslangicError = errorStart || errorBaslangic || (formErrors && formErrors[actualStartName]);
    const bitisError = errorEnd || errorBitis || (formErrors && formErrors[actualEndName]);
    const hasError = !!baslangicError || !!bitisError;

    // Helper functions for Date string conversion
    const formatDateToDisplay = (dateStr?: string | null) => {
        const normalized = normalizeDate(dateStr);
        if (!normalized) return '';
        const parts = normalized.split('-');
        if (parts.length === 3) {
            return `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
        return normalized;
    };

    const getDateString = (d: Date) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const isSameDay = (d: Date, dateStr?: string | null) => {
        const normalized = normalizeDate(dateStr);
        if (!normalized) return false;
        return getDateString(d) === normalized;
    };

    const isDayInRange = (d: Date, startStr?: string | null, endStr?: string | null) => {
        const s = normalizeDate(startStr);
        const e = normalizeDate(endStr);
        if (!s || !e) return false;
        const currentStr = getDateString(d);
        return currentStr > s && currentStr < e;
    };

    // Calendar Generation Helpers
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        // Monday as start of the week
        let startDayOfWeek = firstDayOfMonth.getDay() - 1;
        if (startDayOfWeek === -1) startDayOfWeek = 6;

        const totalDays = lastDayOfMonth.getDate();
        const days: (Date | null)[] = [];

        for (let i = 0; i < startDayOfWeek; i++) {
            days.push(null);
        }
        for (let day = 1; day <= totalDays; day++) {
            days.push(new Date(year, month, day));
        }
        return days;
    };

    const getWeekDays = () => {
        const lang = i18n.language || 'tr';
        if (lang.startsWith('en')) {
            return ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
        }
        return ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
    };

    const getMonthName = (monthIndex: number) => {
        const lang = i18n.language || 'tr';
        const trMonths = [
            'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
            'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
        ];
        const enMonths = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return lang.startsWith('en') ? enMonths[monthIndex] : trMonths[monthIndex];
    };

    // Month Navigation handlers
    const handlePrevMonth = (e: React.MouseEvent) => {
        e.stopPropagation();
        setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const handleNextMonth = (e: React.MouseEvent) => {
        e.stopPropagation();
        setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    // Range Selection logic
    const handleDayClick = (dayDate: Date) => {
        const dateStr = getDateString(dayDate);
        const s = normalizeDate(actualStartDate);
        const e = normalizeDate(actualEndDate);

        if (!s || (s && e)) {
            // First click: set start date, clear end date
            if (onChange) {
                onChange(dateStr, '');
            }
        } else {
            // Second click: check if clicked date is before start date
            if (dateStr < s) {
                if (onChange) {
                    onChange(dateStr, '');
                }
            } else {
                if (onChange) {
                    onChange(s, dateStr);
                }
                setIsOpen(false); // Close popover when range selection finishes
            }
        }
    };

    return (
        <div id={id} ref={containerRef} className={`flex-col w-full ${className}`} style={{ position: 'relative' }}>
            <div 
                className={`tarih-araligi-input-container ${hasError ? 'is-invalid' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && setIsOpen(prev => !prev)}
            >
                <input
                    type="text"
                    readOnly
                    name={actualStartName}
                    value={formatDateToDisplay(actualStartDate)}
                    placeholder={placeholderStart || placeholderBaslangic || t('TarihAraligi_baslangic') || 'Başlangıç'}
                    className="tarih-araligi-sub-input start-date"
                    disabled={disabled}
                />

                <span className="tarih-araligi-separator">-</span>

                <input
                    type="text"
                    readOnly
                    name={actualEndName}
                    value={formatDateToDisplay(actualEndDate)}
                    placeholder={placeholderEnd || placeholderBitis || t('TarihAraligi_bitis') || 'Bitiş'}
                    className="tarih-araligi-sub-input end-date"
                    disabled={disabled}
                />

                <div className="flex-grow flex-1" />

                <span className="tarih-araligi-icon-btn">
                    <Calendar size={16} />
                </span>

                {isOpen && !disabled && (
                    <div className="date-range-popover" onClick={(e) => e.stopPropagation()}>
                        <div className="popover-header">
                            <button type="button" className="month-nav-btn" onClick={handlePrevMonth}>
                                &lt;
                            </button>
                            <span className="month-title">
                                {getMonthName(viewDate.getMonth())} {viewDate.getFullYear()}
                            </span>
                            <button type="button" className="month-nav-btn" onClick={handleNextMonth}>
                                &gt;
                            </button>
                        </div>

                        <div className="days-grid">
                            {getWeekDays().map(day => (
                                <span key={day} className="day-name">{day}</span>
                            ))}
                        </div>

                        <div className="days-grid">
                            {getDaysInMonth(viewDate).map((day, idx) => {
                                if (!day) return <span key={`empty-${idx}`} className="day-cell empty" />;

                                const isStart = isSameDay(day, actualStartDate);
                                const isEnd = isSameDay(day, actualEndDate);
                                const isInRange = isDayInRange(day, actualStartDate, actualEndDate);
                                const dayStr = getDateString(day);

                                return (
                                    <button
                                        key={dayStr}
                                        type="button"
                                        className={`day-cell ${isStart ? 'range-start' : ''} ${isEnd ? 'range-end' : ''} ${isInRange ? 'range-between' : ''}`}
                                        onClick={() => handleDayClick(day)}
                                    >
                                        {day.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {(baslangicError || bitisError) && (
                <div className="flex-col gap-4 mt-4 w-full">
                    {baslangicError && <FieldError error={baslangicError} />}
                    {bitisError && bitisError !== baslangicError && <FieldError error={bitisError} />}
                </div>
            )}
        </div>
    );
});

DateRangeInput.displayName = 'DateRangeInput';

export { DateRangeInput as TarihAraligiSecici };
export default DateRangeInput;
