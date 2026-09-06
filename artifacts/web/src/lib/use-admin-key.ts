"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "movieapi.mediaAdminKey";

/**
 * The catalog/media admin endpoints are protected by a static
 * `x-media-admin-key` header (see MEDIA_ADMIN_KEY on the API server), not
 * by Clerk. This hook keeps that key in localStorage on the admin's own
 * browser so it doesn't have to be re-entered on every visit.
 */
export function useAdminKey() {
  const [key, setKeyState] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setKeyState(window.localStorage.getItem(STORAGE_KEY) ?? "");
    setHydrated(true);
  }, []);

  const setKey = useCallback((value: string) => {
    setKeyState(value);
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return { key, setKey, hydrated };
}
