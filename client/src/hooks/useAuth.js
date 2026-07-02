import { useState, useEffect, useCallback } from 'react';

export const useAuth = () => {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadUserFromStorage = useCallback(() => {
        const token = localStorage.getItem('token');
        console.log('[useAuth] token exists:', !!token);

        if (!token) {
            console.log('[useAuth] No token, setting user null');
            setUser(null);
            setIsLoading(false);
            return;
        }

        try {
            // Giải mã payload của JWT (không cần verify chữ ký ở client)
            const payload = JSON.parse(atob(token.split('.')[1]));
            console.log('[useAuth] JWT payload:', payload);

            const userData = {
                id: payload.userId,
                email: payload.userEmail || localStorage.getItem('userEmail'),
                name: payload.userName || localStorage.getItem('userName'),
            };

            console.log('[useAuth] userData:', userData);
            setUser({ ...userData, token });
        } catch (e) {
            console.error('Failed to decode token:', e);
            setUser(null);
        }
        setIsLoading(false);
    }, []);

    const login = useCallback((userData, token) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        setUser({ ...userData, token });
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('userName');
        localStorage.removeItem('userEmail');
        setUser(null);
    }, []);

    useEffect(() => {
        loadUserFromStorage();
        const handleStorageChange = () => loadUserFromStorage();
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
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