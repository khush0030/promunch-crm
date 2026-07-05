"use client";

// App-wide TanStack Query provider (audit: "no data-fetching library").
// The client is created in state so it is stable across re-renders and never
// shared between requests. Defaults stay conservative — views opt in to
// polling with refetchInterval, matching the setInterval patterns they replace.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
