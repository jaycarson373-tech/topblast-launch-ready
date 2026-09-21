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
      { src: "/icon-venues.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon-venues.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
