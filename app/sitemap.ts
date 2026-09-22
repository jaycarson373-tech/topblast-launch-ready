import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/explore", "/docs", "/test", "/launch"].map((path) => ({ url: `https://topblastlaunch.xyz${path}` }));
}
