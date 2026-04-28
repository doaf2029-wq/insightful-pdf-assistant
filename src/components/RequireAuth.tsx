import { Navigate } from "react-router-dom";
import { useAuth } from "@/providers/AuthProvider";

export const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/signin" replace />;
  return children;
};