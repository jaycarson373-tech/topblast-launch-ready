export function validateTokenImage(file: { type: string; size: number }) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image");
  if (!file.size || file.size > 2_000_000) throw new Error("Image must be between 1 byte and 2 MB");
}
