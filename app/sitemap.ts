import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/explore", "/docs", "/launch"].map((path) => ({ url: `https://topblastlaunch.xyz${path}` }));
}
