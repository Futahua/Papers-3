export function parseBackpackProjectWebUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('only http(s) URLs may be opened');
  }
  return parsed.toString();
}
