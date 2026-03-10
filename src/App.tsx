import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";
import { ResellerAuthProvider } from "@/contexts/ResellerAuthContext";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import PlayerPage from "./pages/PlayerPage";
import VodPlayerPage from "./pages/VodPlayerPage";
import SeriesDetailPage from "./pages/SeriesDetailPage";
import SeriesPlayerPage from "./pages/SeriesPlayerPage";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import ResellerLogin from "./pages/ResellerLogin";
import ResellerDashboard from "./pages/ResellerDashboard";
import NotFound from "./pages/NotFound";
import InstallPage from "./pages/InstallPage";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isLoggedIn } = useAuth();
  return isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />;
};

const AppRoutes = () => {
  const { isLoggedIn } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isLoggedIn ? <Navigate to="/player" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Navigate to="/player" replace /></ProtectedRoute>} />
      <Route path="/channels" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/player" element={<ProtectedRoute><PlayerPage /></ProtectedRoute>} />
      <Route path="/player/:category" element={<ProtectedRoute><PlayerPage /></ProtectedRoute>} />
      <Route path="/vod/:id" element={<ProtectedRoute><VodPlayerPage /></ProtectedRoute>} />
      <Route path="/series/:id" element={<ProtectedRoute><SeriesDetailPage /></ProtectedRoute>} />
      <Route path="/series/:seriesId/play/:episodeId" element={<ProtectedRoute><SeriesPlayerPage /></ProtectedRoute>} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin/panel" element={<AdminDashboard />} />
      <Route path="/reseller" element={<ResellerLogin />} />
      <Route path="/reseller/panel" element={<ResellerDashboard />} />
      <Route path="/install" element={<InstallPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <AdminAuthProvider>
          <ResellerAuthProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ResellerAuthProvider>
        </AdminAuthProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
