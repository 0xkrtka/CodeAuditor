"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";
import { ritualChain } from "@/lib/ritual";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:     2,
      staleTime: 10_000, // 10s — Ritual has fast blocks
    },
  },
});

const wagmiConfig = createConfig({
  chains:     [ritualChain],
  transports: {
    [ritualChain.id]: http("https://rpc.ritualfoundation.org", {
      timeout:    30_000,
      retryCount: 3,
    }),
  },
  connectors: [
    // Use injected() only — works with MetaMask, OKX, Rabby, and any EIP-1193 wallet
    // This avoids pulling in MetaMask SDK (causes encoding dep warning)
    injected({ shimDisconnect: true }),
  ],
  batch: {
    multicall: { wait: 100 }, // batch multicall within 100ms window
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
