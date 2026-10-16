import type { Metadata, Viewport } from "next";
import { HelpdeskWidget } from "@/features/helpdesk/components/helpdesk-widget";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "FTM",
  title: "FTM - Fuel Tank Management",
  description:
    "Foundation for fuel tank telemetry management.",
  icons: {
    apple: [
      {
        sizes: "180x180",
        type: "image/png",
        url: "/logo/apple-icon-180x180.png",
      },
    ],
    icon: [
      {
        sizes: "32x32",
        type: "image/png",
        url: "/logo/favicon-32x32.png",
      },
      {
        sizes: "192x192",
        type: "image/png",
        url: "/logo/android-icon-192x192.png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FTM",
  },
  other: {
    "msapplication-TileColor": "#ffffff",
    "msapplication-TileImage": "/logo/ms-icon-144x144.png",
    "msapplication-config": "/browserconfig.xml",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        {children}
        <HelpdeskWidget />
      </body>
    </html>
  );
}
