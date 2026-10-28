import { useState, useEffect, useCallback } from 'react';
import { queryClient } from '../lib/queryClient';

export const useAuth = () => {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadUserFromStorage = useCallback(() => {
        const token = localStorage.getItem('token');

        if (!token) {
            setUser(null);
            setIsLoading(false);
            return;
        }

        try {
            // Decode JWT payload (no signature verification needed on client)
            const payload = JSON.parse(atob(token.split('.')[1]));

            const userData = {
                id: payload.userId,
                email: payload.userEmail || localStorage.getItem('userEmail'),
                name: payload.userName || localStorage.getItem('userName'),
            };

            setUser({ ...userData, token });
        } catch (e) {
            console.error('Failed to decode token:', e);
            setUser(null);
        }
        setIsLoading(false);
    }, []);

    const login = useCallback((userData, token) => {
        queryClient.cancelQueries();
        queryClient.clear();
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        setUser({ ...userData, token });
        window.dispatchEvent(new Event('covai:auth-change'));
    }, []);

    const logout = useCallback(() => {
        queryClient.cancelQueries();
        queryClient.clear();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('userName');
        localStorage.removeItem('userEmail');
        Object.keys(localStorage).filter(key => key.startsWith('latestSnapshot_')).forEach(key => localStorage.removeItem(key));
        Object.keys(sessionStorage).filter(key => key.startsWith('covai_running_processes') || key.startsWith('covai_snapshot_suggestions_')).forEach(key => sessionStorage.removeItem(key));
        window.dispatchEvent(new Event('covai:auth-change'));

        // Clear any other potential auth keys if they exist
        // Ensure state is fully reset
        setUser(null);

        // Force reload or redirect handled by component using useAuth
    }, []);

    useEffect(() => {
        loadUserFromStorage();
        const handleStorageChange = () => { queryClient.cancelQueries(); queryClient.clear(); loadUserFromStorage(); };
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('covai:auth-change', handleStorageChange);
        return () => { window.removeEventListener('storage', handleStorageChange); window.removeEventListener('covai:auth-change', handleStorageChange); };
    }, [loadUserFromStorage]);

    return {
        user,
        isLoading,
        isAuthenticated: !!user,
        userId: user?.id,
        token: user?.token,
        login,
        logout,
        refresh: loadUserFromStorage,
    };
};
