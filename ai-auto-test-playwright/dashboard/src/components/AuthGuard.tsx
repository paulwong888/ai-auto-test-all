import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (token) {
      setAllowed(true);
      return;
    }
    void fetch("/api/projects")
      .then((res) => {
        setAllowed(res.status !== 401);
      })
      .catch(() => setAllowed(false));
  }, [location.pathname]);

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        加载中…
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
