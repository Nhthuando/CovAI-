import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { useState } from 'react';
import LoginPage from './components/LoginPage';
import DashboardPage from './components/DashboardPage';
import { clearAuth, getAuthToken, getStoredUser, setAuth, type AuthInfo } from './api/client';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getAuthToken()));
  const [user, setUser] = useState(() => getStoredUser());

  const handleLogin = (auth: AuthInfo) => {
    setAuth(auth);
    setUser({ name: auth.name, email: auth.email });
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearAuth();
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage onLogin={handleLogin} />
            )
          }
        />
        <Route
          path="/dashboard"
          element={
            isAuthenticated ? (
              <DashboardPage user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
