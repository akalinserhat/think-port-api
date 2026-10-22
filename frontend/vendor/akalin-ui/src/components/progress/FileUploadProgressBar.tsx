import React from 'react';
import BaseProgressBar from '../base/progress/BaseProgressBar';

export interface FileUploadProgressBarProps {
    progress: number;
    loadedBytes: number;
    totalBytes: number;
}

const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const FileUploadProgressBar: React.FC<FileUploadProgressBarProps> = ({ progress, loadedBytes, totalBytes }) => {
    const leftLabel = `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`;
    const rightLabel = `%${Math.round(progress)}`;

    return (
        <BaseProgressBar
            progress={progress}
            colorClass="bg-primary"
            height={8}
            labelLeft={leftLabel}
            labelRight={rightLabel}
        />
    );
};

export default FileUploadProgressBar;
