import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MedData Escrow",
  description: "AI-matched medical research data, protected by PayPal escrow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">MedData<span>Escrow</span></a>
          <span className="mode-badge">
            {process.env.NEXT_PUBLIC_PAYPAL_MODE === "sandbox" ? "PayPal Sandbox" : "Mock mode"}
          </span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
