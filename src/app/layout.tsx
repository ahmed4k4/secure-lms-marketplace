import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LearnSpace — Learning Marketplace", template: "%s | LearnSpace" },
  description: "A secure multi-instructor learning platform for practical skills and structured courses.",
  applicationName: "LearnSpace",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Readex+Pro:wght@400;500;600;700&family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  </head><body>{children}</body></html>;
}
