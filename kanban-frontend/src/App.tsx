import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import BoardsPage from "./pages/BoardsPage";
import BoardPage from "./pages/BoardPage";
import InvitePage from "./pages/InvitePage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) {
    // Preserve the URL the user was trying to reach so LoginPage can
    // redirect them back after successful authentication instead of
    // always going to /boards.
    const redirect = location.pathname + location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route
            path="/boards"
            element={
              <RequireAuth>
                <BoardsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/board/:boardId"
            element={
              <RequireAuth>
                <BoardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/invite/:token"
            element={
              <RequireAuth>
                <InvitePage />
              </RequireAuth>
            }
          />
          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/login" replace />} />

        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
