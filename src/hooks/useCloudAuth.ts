"use client";

import { useCallback, useEffect, useState } from "react";

const CLOUD_URL = process.env.NEXT_PUBLIC_ELIZA_CLOUD_URL || "http://localhost:3000";
const AUTH_TOKEN_KEY = "miniapp_auth_token";
const USER_ID_KEY = "miniapp_user_id";
const ORG_ID_KEY = "miniapp_org_id";

interface CloudUser {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
}

interface CloudAuthState {
  ready: boolean;
  authenticated: boolean;
  user: CloudUser | null;
  userId: string | null;
  organizationId: string | null;
  authToken: string | null;
  login: () => Promise<void>;
  logout: () => void;
}

function getStoredValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

export function useCloudAuth(): CloudAuthState {
  const [ready, setReady] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => getStoredValue(AUTH_TOKEN_KEY));
  const [userId, setUserId] = useState<string | null>(() => getStoredValue(USER_ID_KEY));
  const [organizationId, setOrganizationId] = useState<string | null>(() => getStoredValue(ORG_ID_KEY));
  const [user, setUser] = useState<CloudUser | null>(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(ORG_ID_KEY);
    setAuthToken(null);
    setUserId(null);
    setOrganizationId(null);
    setUser(null);
  }, []);

  const fetchUserInfo = useCallback(async (token: string) => {
    try {
      const response = await fetch(`${CLOUD_URL}/api/v1/miniapp/user`, {
        headers: {
          "X-Miniapp-Token": token,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          avatar: data.user.avatar,
        });
      } else if (response.status === 401) {
        clearAuth();
      }
    } catch {
      console.warn("[useCloudAuth] Failed to fetch user info");
    }
  }, [clearAuth]);

  useEffect(() => {
    queueMicrotask(() => {
      if (authToken) {
        fetchUserInfo(authToken);
      }
      setReady(true);
    });
  }, [authToken, fetchUserInfo]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_TOKEN_KEY) {
        const newToken = localStorage.getItem(AUTH_TOKEN_KEY);
        const newUserId = localStorage.getItem(USER_ID_KEY);
        const newOrgId = localStorage.getItem(ORG_ID_KEY);

        if (newToken && newUserId) {
          setAuthToken(newToken);
          setUserId(newUserId);
          setOrganizationId(newOrgId);
          fetchUserInfo(newToken);
        } else {
          clearAuth();
        }
      }
    };

    const handleAuthChanged = () => {
      const newToken = localStorage.getItem(AUTH_TOKEN_KEY);
      const newUserId = localStorage.getItem(USER_ID_KEY);
      const newOrgId = localStorage.getItem(ORG_ID_KEY);

      if (newToken && newUserId) {
        setAuthToken(newToken);
        setUserId(newUserId);
        setOrganizationId(newOrgId);
        fetchUserInfo(newToken);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("miniapp_auth_changed", handleAuthChanged);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("miniapp_auth_changed", handleAuthChanged);
    };
  }, [fetchUserInfo, clearAuth]);

  const login = useCallback(async () => {
    const callbackUrl = `${window.location.origin}/auth/callback`;

    const response = await fetch(`${CLOUD_URL}/api/auth/miniapp-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        callbackUrl,
        appId: "otc-agent",
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create auth session");
    }

    const { loginUrl } = await response.json();
    const absoluteLoginUrl = loginUrl.startsWith("http")
      ? loginUrl
      : `${CLOUD_URL}${loginUrl}`;
    window.location.href = absoluteLoginUrl;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    window.location.href = "/";
  }, [clearAuth]);

  return {
    ready,
    authenticated: !!authToken,
    user,
    userId,
    organizationId,
    authToken,
    login,
    logout,
  };
}

export function getCloudAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}


