import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { NotificationsProvider } from './context/NotificationsContext';
import { ToastProvider } from './context/ToastContext';
import App from './App';
import './styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <SocketProvider>
        <NotificationsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </NotificationsProvider>
      </SocketProvider>
    </AuthProvider>
  </StrictMode>
);
