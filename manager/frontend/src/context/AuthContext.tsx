import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { authMe, authLogout, setToken, getToken, clearToken, setCurrentUser, verify2FALogin, SessionExpiredError } from "../api/client";

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  role: string;
  pending2fa: boolean;
  needs2FASetup: boolean;
  loading: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<void>;
  complete2FASetup: () => void;
  logout: () => void;
  clearExpired: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: "user",
  pending2fa: false,
  needs2FASetup: false,
  loading: true,
  sessionExpired: false,
  login: async () => false,
  verify2FA: async () => {},
  complete2FASetup: () => {},
  logout: () => {},
  clearExpired: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const API_BASE = "http://localhost:8000/api";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [pending2faSession, setPending2faSession] = useState<string | null>(null);
  const [needs2FASetup, setNeeds2FASetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [role, setRole] = useState("user");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    authMe()
      .then((data) => {
        setUser(data.user);
        setCurrentUser(data.user);
        setRole(data.role);
        if (data.require_2fa && !data.totp_enabled) {
          setNeeds2FASetup(true);
        }
      })
      .catch((e) => {
        clearToken();
        setCurrentUser(null);
        if (e instanceof SessionExpiredError) return;
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof SessionExpiredError) {
        e.preventDefault();
        setUser(null);
        setCurrentUser(null);
        setRole("user");
        setPending2faSession(null);
        setNeeds2FASetup(false);
        setSessionExpired(true);
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    const res = await fetch(`${API_BASE}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || "Invalid email or password");
    }
    const data = await res.json();
    if (data.status === "2fa_required" && data["2fa_session"]) {
      setPending2faSession(data["2fa_session"]);
      return true;
    }
    if (data.token) setToken(data.token);
    if (data.require_2fa && !data.totp_enabled) {
      setUser(data.user);
      setCurrentUser(data.user);
      setNeeds2FASetup(true);
      return false;
    }
    setUser(data.user);
    setCurrentUser(data.user);
    return false;
  }, []);

  const verify2FA = useCallback(async (code: string) => {
    if (!pending2faSession) throw new Error("No pending 2FA session");
    const data = await verify2FALogin(pending2faSession, code);
    if (data.token) setToken(data.token);
    setPending2faSession(null);
    const me = await authMe();
    setUser(me.user);
    setCurrentUser(me.user);
    setRole(me.role);
  }, [pending2faSession]);

  const complete2FASetup = useCallback(() => {
    setNeeds2FASetup(false);
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setUser(null);
    setCurrentUser(null);
    setRole("user");
    setPending2faSession(null);
    setNeeds2FASetup(false);
    setSessionExpired(false);
  }, []);

  const clearExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  return (
    <AuthContext value={{ user, role, pending2fa: !!pending2faSession, needs2FASetup, loading, sessionExpired, login, verify2FA, complete2FASetup, logout, clearExpired }}>
      {children}
    </AuthContext>
  );
}
