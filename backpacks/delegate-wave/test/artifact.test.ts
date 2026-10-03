/**
 * Proves the built artifact is one Papers can actually serve and run.
 *
 * `npm run build && git diff --exit-code -- public` proves the committed output
 * matches source. It proves nothing about whether that output loads. A candidate
 * could build reproducibly, pass every test, survive semantic review, integrate —
 * and display a blank surface, because the one thing nobody checked was whether
 * the bundle executes.
 *
 * jsdom is not Papers. What this catches is the class of failure that turns the
 * surface blank without any other signal: an entry that does not parse, throws on
 * execution, mounts nothing, or carries markup this scheme refuses to serve.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const publicDir = path.join(process.cwd(), 'public');
const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');

describe('the built Backpack artifact', () => {
  it('has a mount point and exactly one module entry', () => {
    expect(html).toContain('id="root"');
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('type="module"');
  });

  it('carries no crossorigin attribute', () => {
    // papers-backpack: is registered with corsEnabled:false. A crossorigin
    // attribute forces a CORS-mode fetch the scheme will not satisfy, and the
    // only symptom is a blank surface.
    expect(html).not.toMatch(/crossorigin/i);
  });

  it('references its assets relatively, not from the server root', () => {
    // The page is served from a custom-scheme root; an absolute /assets/ path
    // resolves outside the project.
    const src = html.match(/<script[^>]*src="([^"]+)"/)?.[1];
    expect(src).toBeTruthy();
    expect(src!.startsWith('/')).toBe(false);
  });

  it('executes and mounts something into #root', async () => {
    const assets = readdirSync(path.join(publicDir, 'assets')).filter((f: string) => f.endsWith('.js'));
    expect(assets.length).toBeGreaterThan(0);

    document.body.innerHTML = '<div id="root"></div>';
    // Importing the real built bundle: if the entry throws, fails to parse, or
    // mounts nothing, this is where it shows.
    await import(/* @vite-ignore */ path.join(publicDir, 'assets', assets[0]!));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = document.getElementById('root');
    expect(root).toBeTruthy();
    expect(root!.childElementCount).toBeGreaterThan(0);
  });
});
