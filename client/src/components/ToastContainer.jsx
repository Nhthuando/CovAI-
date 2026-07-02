import React from 'react';
import { Toast } from './Toast.jsx';

/**
 * Manages and displays multiple toast notifications
 */
export const ToastContainer = ({ toasts, setToasts }) => {

    const removeToast = (id) => {
        setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
    };

    return (
        <div style={{
            position: 'fixed',
            top: '20px', // Changed from bottom to top
            left: '20px', // Changed from right to left
            right: 'auto', // Reset right
            bottom: 'auto', // Reset bottom
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
        }}>
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    title={toast.title}
                    message={toast.message}
                    type={toast.type}
                    duration={toast.duration}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </div>
    );
};