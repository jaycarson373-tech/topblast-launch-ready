import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://topblast-stonkfun-launchpad.vercel.app"),
  title: { default: "TopBlast Launch | StonkFun + Pump.fun", template: "%s | TopBlast Launch" },
  description: "Launch through StonkFun or Pump.fun with funded TopBlast rewards for eligible verified buyers below their entry.",
  applicationName: "TopBlast Launch",
  icons: { icon: "/icon-venues.png", apple: "/apple-icon-venues.png" },
  openGraph: {
    title: "TopBlast Launch",
    description: "Launch through StonkFun or Pump.fun with funded TopBlast rewards for eligible verified buyers below their entry.",
    type: "website",
    images: [{ url: "/topblast-venues.png", width: 1254, height: 1254, alt: "TopBlast Launch" }],
  },
  twitter: { card: "summary", title: "TopBlast Launch", description: "StonkFun or Pump.fun underneath. TopBlast on top.", images: ["/topblast-venues.png"] },
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
