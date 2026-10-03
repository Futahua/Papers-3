import { describe, expect, it } from 'vitest';
import { extractPageTitle, resolveWebLinkIcon } from '../../src/main/backpacks/backpackProjectSiteIcon';

// resolveWebLinkIcon validates its input before its own try/catch begins, so
// every case here throws synchronously rather than resolving with
// { icon: null }. The caller (backpackProjectService.resolveWebLinkIcon, and
// above that BackpackProjectFrame's postMessage handler) already converts
// any thrown error into a normal ok:false response — this test only proves
// the SSRF blocklist itself rejects each address before any network request
// would be attempted.
describe('Backpack project web-link icon resolver — SSRF blocklist', () => {
  const blockedUrls = [
    'http://127.0.0.1/icon.png',
    'http://127.1.2.3/icon.png',
    'http://localhost/icon.png',
    'http://[::1]/icon.png',
    'http://169.254.169.254/icon.png',
    'http://169.254.1.1/icon.png',
    'http://10.0.0.5/icon.png',
    'http://172.16.0.1/icon.png',
    'http://172.31.255.255/icon.png',
    'http://192.168.1.1/icon.png',
    'http://0.0.0.0/icon.png',
    'http://metadata.google.internal/icon.png',
    'http://100.64.0.1/icon.png',
  ];

  it.each(blockedUrls)('rejects %s without making a network request', async (url) => {
    await expect(resolveWebLinkIcon(url)).rejects.toThrow(/private or blocked destination/i);
  });

  it('rejects a URL carrying embedded credentials', async () => {
    await expect(resolveWebLinkIcon('http://user:pass@example.com/icon.png')).rejects.toThrow(
      /credentials not allowed/i,
    );
  });

  it('rejects non-http(s) protocols', async () => {
    await expect(resolveWebLinkIcon('file:///etc/passwd')).rejects.toThrow(
      /only http\/https allowed/i,
    );
  });

  it('rejects a malformed URL', async () => {
    await expect(resolveWebLinkIcon('not a url')).rejects.toThrow(/invalid URL/i);
  });

  it('rejects an oversized URL', async () => {
    const oversized = 'https://example.com/' + 'a'.repeat(3_000);
    await expect(resolveWebLinkIcon(oversized)).rejects.toThrow(/invalid URL length/i);
  });
});

describe('extractPageTitle', () => {
  it('extracts a simple title', () => {
    expect(extractPageTitle('<html><head><title>Example Site</title></head></html>')).toBe('Example Site');
  });

  it('decodes HTML entities in the title', () => {
    expect(extractPageTitle('<title>Fish &amp; Chips &mdash; &lt;Test&gt;</title>')).toBe(
      'Fish & Chips &mdash; <Test>',
    );
  });

  it('collapses internal whitespace and trims', () => {
    expect(extractPageTitle('<title>\n   Spaced   Out   \n</title>')).toBe('Spaced Out');
  });

  it('is case-insensitive and tolerates attributes on the tag', () => {
    expect(extractPageTitle('<TITLE class="x">Loud Title</TITLE>')).toBe('Loud Title');
  });

  it('returns null when there is no title tag', () => {
    expect(extractPageTitle('<html><head></head><body>No title here</body></html>')).toBeNull();
  });

  it('returns null for an empty or whitespace-only title', () => {
    expect(extractPageTitle('<title></title>')).toBeNull();
    expect(extractPageTitle('<title>   </title>')).toBeNull();
  });
});
