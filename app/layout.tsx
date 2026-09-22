import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PlatformProvider } from "@/components/platform-state";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

export const metadata: Metadata = {
  metadataBase: new URL("https://topblastlaunch.xyz"),
  title: { default: "TopBlast Launch | Launch Underneath. Rewards on Top.", template: "%s | TopBlast Launch" },
  description: "Launch through StonkFun or Pump.fun and add funded rewards for verified holders below their entry.",
  alternates: { canonical: "./" },
  applicationName: "TopBlast Launch",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "TopBlast Launch | Launch Underneath. Rewards on Top.",
    description: "Launch through StonkFun or Pump.fun and add funded rewards for verified holders below their entry.",
    type: "website",
    images: [{ url: "https://topblast-stonkfun-launchpad.vercel.app/og-image.png", width: 1200, height: 630, alt: "Launch underneath. Rewards on top. Your entry sets the line." }],
  },
  twitter: { card: "summary_large_image", title: "TopBlast Launch", description: "Launch underneath. Rewards on top.", images: ["https://topblast-stonkfun-launchpad.vercel.app/og-image.png"] },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let featuredMint: string | undefined;
  if (process.env.FEATURED_TOKEN_MINT && isDatabaseConfigured()) {
    const { data } = await getAdminDb().from("launches").select("mint,launch_signature").eq("mint", process.env.FEATURED_TOKEN_MINT).eq("is_test", false).eq("listing_hidden", false).in("status", ["active", "paused"]).maybeSingle();
    if (data?.mint && data.launch_signature) featuredMint = data.mint;
  }
  return (
    <html lang="en">
      <body>
        <PlatformProvider><SiteNav featuredMint={featuredMint} />
        {children}
        <SiteFooter /></PlatformProvider>
      </body>
    </html>
  );
}
