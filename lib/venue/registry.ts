import { StonkFunAdapter } from "./stonkfun-adapter";
import { PumpFunAdapter } from "./pumpfun-adapter";
import type { LaunchVenueAdapter } from "./launch-venue-adapter";

export function launchVenue(venue: string = "stonkfun"): LaunchVenueAdapter {
  if (venue === "stonkfun") return new StonkFunAdapter();
  if (venue === "pumpfun") return new PumpFunAdapter();
  throw new Error(`Unsupported launch venue: ${venue}`);
}
