"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";
import { ritualChain } from "@/lib/ritual";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:     2,
      staleTime: 10_000,
    },
  },
});

// Singleton connector — must be created once outside component
const injectedConnector = injected({ shimDisconnect: true });

const wagmiConfig = createConfig({
  chains:     [ritualChain],
  transports: {
    [ritualChain.id]: http("https://rpc.ritualfoundation.org", {
      timeout:    30_000,
      retryCount: 3,
    }),
  },
  connectors: [injectedConnector],
  // Multicall disabled — Ritual testnet may not have multicall3 deployed
  batch: { multicall: false },
});

export { wagmiConfig };

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
