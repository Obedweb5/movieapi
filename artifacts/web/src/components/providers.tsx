"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

/**
 * The API lives on a different origin than this app (a VPS), so browser
 * requests can't rely on same-origin session cookies. Instead we fetch a
 * Clerk session token per request and attach it as a Bearer token — this is
 * exactly what `setAuthTokenGetter` exists for.
 */
function AuthBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setBaseUrl(process.env.NEXT_PUBLIC_API_URL ?? null);
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#c9a44c",
          colorBackground: "#181b26",
          colorText: "#ede9e0",
          colorInputBackground: "#12141c",
          colorInputText: "#ede9e0",
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AuthBridge />
        {children}
      </QueryClientProvider>
    </ClerkProvider>
  );
}
