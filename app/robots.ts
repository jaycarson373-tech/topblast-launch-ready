import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/creator", "/launch/test", "/test"] }, sitemap: "https://topblastlaunch.xyz/sitemap.xml" };
}
