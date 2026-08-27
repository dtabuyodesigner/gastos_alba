import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { RequireAuth } from './features/auth/RequireAuth'
import { LoginPage } from './features/auth/LoginPage'
import { AppLayout } from './components/AppLayout'
import { NotificationsProvider } from './features/notifications/NotificationsProvider'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { ConfigErrorScreen } from './components/ConfigErrorScreen'
import { HomePage } from './pages/HomePage'
import { HistoryPage } from './pages/HistoryPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ExpenseListPage } from './features/expenses/ExpenseListPage'
import { NewExpensePage } from './features/expenses/NewExpensePage'
import { ExpenseDetailPage } from './features/expenses/ExpenseDetailPage'
import { configError } from './lib/supabase'

export function App() {
  // Sin configuracion valida no se emite ni una sola consulta.
  if (configError) return <ConfigErrorScreen message={configError} />

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <NotificationsProvider>
                  <AppLayout />
                </NotificationsProvider>
              </RequireAuth>
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/gastos" element={<ExpenseListPage />} />
            <Route path="/gastos/nuevo" element={<NewExpensePage />} />
            <Route path="/gastos/:id" element={<ExpenseDetailPage />} />
            <Route path="/historico" element={<HistoryPage />} />
            <Route path="/notificaciones" element={<NotificationsPage />} />
            <Route path="/inicio" element={<Navigate to="/" replace />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
