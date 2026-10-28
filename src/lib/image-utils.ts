/** Kept for API compatibility with the hosted app; local images are served as-is. */
export function thumbnailUrl(url: string | undefined | null, _size = 400): string | undefined {
  return url ?? undefined;
}
