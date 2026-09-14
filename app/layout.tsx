import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://topblast-stonkfun-launchpad.vercel.app"),
  title: { default: "TopBlast Launch", template: "%s | TopBlast Launch" },
  description: "Launch on StonkFun with the TopBlast reward engine built in.",
  applicationName: "TopBlast Launch",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
  openGraph: {
    title: "TopBlast Launch",
    description: "Launch on StonkFun with the TopBlast reward engine built in.",
    type: "website",
    images: [{ url: "/topblast-mark.png", width: 1254, height: 1254, alt: "TopBlast Launch" }],
  },
  twitter: { card: "summary", title: "TopBlast Launch", description: "StonkFun underneath. TopBlast on top.", images: ["/topblast-mark.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
