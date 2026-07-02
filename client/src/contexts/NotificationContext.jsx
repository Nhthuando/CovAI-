import React, { createContext, useState, useCallback } from 'react';
import { ToastContainer } from '../components/ToastContainer';

export const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((title, message, type = 'info', duration = 5000) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, title, message, type, duration }]);
    }, []);

    // Listen for custom toast events (from NotificationCenter)
    React.useEffect(() => {
        const handleShowToast = (event) => {
            const { title, message, type, duration } = event.detail;
            addToast(title, message, type, duration);
        };
        window.addEventListener('showToast', handleShowToast);
        return () => window.removeEventListener('showToast', handleShowToast);
    }, [addToast]);

    return (
        <NotificationContext.Provider value={{ addToast }}>
            {children}
            <ToastContainer toasts={toasts} setToasts={setToasts} />
        </NotificationContext.Provider>
    );
};