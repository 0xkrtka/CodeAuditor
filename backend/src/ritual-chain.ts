// Shared chain definition for backend (mirrors frontend lib/ritual.ts)
export const ritualChain = {
  id:   1979,
  name: "Ritual Chain",
  nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: {
      http:      ["https://rpc.ritualfoundation.org"],
      webSocket: ["wss://rpc.ritualfoundation.org/ws"],
    },
  },
} as const;
