import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PlatformProvider } from "@/components/platform-state";
import { registeredFeaturedToken } from "@/lib/db/featured-token";
import { getSiteLinks } from "@/lib/site-links";

export const metadata: Metadata = {
  metadataBase: new URL("https://topblastlaunch.xyz"),
  title: { default: "TopBlast Launch | Launch Underneath. Rewards on Top.", template: "%s | TopBlast Launch" },
  description: "Launch through StonkFun or Pump.fun and add funded rewards for verified holders below their entry.",
  alternates: { canonical: "./" },
  applicationName: "TopBlast Launch",
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "TopBlast Launch | Launch Underneath. Rewards on Top.",
    description: "Launch through StonkFun or Pump.fun and add funded rewards for verified holders below their entry.",
    type: "website",
    images: [{ url: "https://topblast-stonkfun-launchpad.vercel.app/og-image.png", width: 1200, height: 630, alt: "Launch underneath. Rewards on top. Your entry sets the line." }],
  },
  twitter: { card: "summary_large_image", title: "TopBlast Launch", description: "Launch underneath. Rewards on top.", images: ["https://topblast-stonkfun-launchpad.vercel.app/og-image.png"] },
};

export const revalidate = 30;
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const links = getSiteLinks();
  const featuredMint = await registeredFeaturedToken();
  return (
    <html lang="en">
      <body>
        <PlatformProvider><SiteNav featuredMint={featuredMint} xUrl={links.x} />
        {children}
        <SiteFooter /></PlatformProvider>
      </body>
    </html>
  );
}
