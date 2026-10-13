import "./globals.css";
import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { ShieldCheck, Lock } from "./icons";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-mono-jb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MedData Escrow — research data, paid safely",
  description:
    "AI-matched medical research datasets. Payment is held in PayPal escrow until you confirm the data is what you expected.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const sandbox = process.env.NEXT_PUBLIC_PAYPAL_MODE === "sandbox";
  return (
    <html lang="en" className={`${hanken.variable} ${jetbrains.variable}`}>
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            <span className="brand-mark">
              <ShieldCheck size={19} />
            </span>
            MedData <em>Escrow</em>
          </a>
          <span className="mode-badge">
            <span className="dot" />
            {sandbox ? "PayPal Sandbox" : "Mock mode"}
          </span>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <span className="trust">
            <Lock size={14} />
            Funds held in escrow until you confirm the dataset
          </span>
          <span>MedData Escrow · demo</span>
        </footer>
      </body>
    </html>
  );
}
