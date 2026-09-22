import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TopBlast Launch",
    short_name: "TopBlast",
    description: "Launch on StonkFun or Pump.fun with the TopBlast reward engine built in.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf0",
    theme_color: "#ff5a1f",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
