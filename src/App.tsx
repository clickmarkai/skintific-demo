import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navigation from "@/components/Navigation";
import LoginPage from "@/components/LoginPage";
import RegisterPage from "@/components/RegisterPage";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import CartPage from "./pages/Cart";
import ChatWidget from "@/components/ChatWidget";
import { useAuth } from "@/hooks/useAuth";
import QRISPage from "./pages/payment/QRIS";

const ChatWidgetGlobal = () => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return <ChatWidget />;
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={
              <ProtectedRoute>
                <Navigation />
                <Index />
              </ProtectedRoute>
            } />
            <Route path="/cart" element={
              <ProtectedRoute>
                <Navigation />
                <CartPage />
              </ProtectedRoute>
            } />
            <Route path="/payment/qris" element={
              <ProtectedRoute>
                <Navigation />
                <QRISPage />
              </ProtectedRoute>
            } />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          {/* Persist chat across routes */}
          <ChatWidgetGlobal />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
