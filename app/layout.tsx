import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono, Spectral } from "next/font/google";
import "./globals.css";

// Editorial pairing: Spectral (serif) sets the headlines, Inter Tight carries
// body and UI text. Mono carries the escrow states, ids, and money, so it
// ships with tabular figures (see globals.css).
const serif = Spectral({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Match the browser UI chrome (mobile address bar) to the page background.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e0c" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "MedData Escrow — research data, paid for only once it is delivered",
    template: "%s · MedData Escrow",
  },
  description:
    "AI procurement + escrow marketplace for medical research data. Payment is held in PayPal and released only when the delivery is confirmed.",
  openGraph: {
    title: "MedData Escrow",
    description:
      "Research data you can trust, paid for only once it is delivered. AI matching, settled through PayPal escrow.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1280,
        height: 640,
        alt: "MedData Escrow landing page — a held escrow order and its lifecycle",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MedData Escrow",
    description:
      "Research data you can trust, paid for only once it is delivered.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
