import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { SignIn, SignUp } from "./pages/Auth.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import UploadPage from "./pages/Upload.tsx";
import JobDetail from "./pages/JobDetail.tsx";
import { LangProvider } from "./providers/LangProvider.tsx";
import { AuthProvider } from "./providers/AuthProvider.tsx";
import { RequireAuth } from "./components/RequireAuth.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LangProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner richColors closeButton />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/signin" element={<SignIn />} />
              <Route path="/signup" element={<SignUp />} />
              <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/upload" element={<RequireAuth><UploadPage /></RequireAuth>} />
              <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </LangProvider>
  </QueryClientProvider>
);

export default App;
