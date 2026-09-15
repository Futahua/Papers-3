import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy } from '../../src/main/security/backpackProjectScheme';

/**
 * The backpack project policy is a hard security boundary, and exactly one
 * directive was relaxed to let a project page reach a service on this machine.
 * These tests exist so that relaxation cannot quietly widen.
 *
 * Measured before the change, against a real Papers with a listener on loopback:
 * with `connect-src 'none'` the listener received ZERO requests and the page saw
 * `TypeError: Failed to fetch` - refused before the network layer. With loopback
 * allowed, the request IS sent and carries
 * `Origin: papers-backpack://<projectId>`.
 */
const ORIGIN = 'papers-backpack://bp-11111111-2222-4333-8444-555555555555';

function directive(policy: string, name: string): string {
  const found = policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  return found ?? '';
}

describe('backpack project content security policy', () => {
  it('allows connections ONLY to loopback', () => {
    const policy = contentSecurityPolicy(ORIGIN);

    expect(policy).toContain('http://127.0.0.1:*');
    expect(policy).toContain('http://localhost:*');
    // A project page must not reach the network at large. These are the shapes a
    // future edit would most plausibly add "just to make it work".
    expect(policy).not.toContain('http://*');
    expect(policy).not.toContain('https://*');
    expect(policy).not.toContain("connect-src *");
    expect(policy).not.toContain("connect-src 'self' http:");
    expect(policy).not.toMatch(/connect-src[^;]*\bhttps:/);
  });

  it('does not carry the none keyword alongside sources, which Chrome ignores', () => {
    // Chrome logs: "The keyword 'none' must be the only source expression in the
    // directive value, otherwise it is ignored." A directive that silently does
    // nothing is worse than one that is wrong loudly.
    const policy = contentSecurityPolicy(ORIGIN);
    for (const part of policy.split(';')) {
      const trimmed = part.trim();
      if (trimmed.includes("'none'")) {
        expect(trimmed, `directive with 'none' must have no other source: ${trimmed}`)
          .toMatch(/^[a-z-]+ 'none'$/);
      }
    }
  });

  it('keeps every OTHER directive as tight as it was', () => {
    const policy = contentSecurityPolicy(ORIGIN);

    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'script-src')).toBe(`script-src ${ORIGIN}`);
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(policy, 'form-action')).toBe("form-action 'none'");
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
    // style-src keeps unsafe-inline, as it always had, and nothing more.
    expect(directive(policy, 'style-src')).toBe(`style-src ${ORIGIN} 'unsafe-inline'`);
    // No script may come from anywhere but the project's own origin.
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline');
    expect(directive(policy, 'script-src')).not.toContain('unsafe-eval');
  });

  it('scopes every origin-bound directive to the project that asked for it', () => {
    const policy = contentSecurityPolicy(ORIGIN);
    const other = contentSecurityPolicy('papers-backpack://bp-99999999-2222-4333-8444-555555555555');

    // One project's policy never names another project's origin.
    expect(policy).not.toContain('bp-99999999');
    expect(other).not.toContain('bp-11111111');
  });
});
