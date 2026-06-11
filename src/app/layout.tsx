import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title:       "CodeAuditor | RITUAL",
  description: "AI-powered Solidity security auditing inside a TEE on Ritual Chain. LLM inference via precompile 0x0802, SSE streaming, pay-per-audit via X402 micropayments.",
  keywords:    "solidity audit, smart contract security, ritual chain, AI audit, web3 security, on-chain LLM",
  icons: {
    icon:       "/favicon.png",
    shortcut:   "/favicon.png",
    apple:      "/favicon.png",
  },
  openGraph: {
    title:       "CodeAuditor | RITUAL",
    description: "Paste your contract. Pay one micro-fee. Get a TEE-verified AI audit streaming in real-time, stored on-chain forever.",
    type:        "website",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "CodeAuditor | RITUAL",
    description: "LLM inside TEE audits your Solidity. Results stream via SSE. Stored on Ritual Chain forever.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        {/* Tabler Icons */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css"
        />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="shortcut icon" href="/favicon.png" type="image/png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0A0A0B" />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
