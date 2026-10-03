import { describe, expect, it } from 'vitest';

import { buildCandidatePickerDocument } from '../../src/main/windows/candidatePickerDocument';

describe('candidate picker document', () => {
  it('keeps candidate data in the JSON island and escapes markup-capable titles', () => {
    const html = buildCandidatePickerDocument([
      { id: 'c1', title: '</script><img src=x onerror=alert(1)>', icon: null, current: false },
    ]);

    expect(html).not.toContain('</script><img src=x');
    expect(html).toContain('\\u003c/script>\\u003cimg src=x onerror=alert(1)>');
    expect(html).toContain('id="data" type="application/json"');
  });

  it('keeps the fixed chooser interaction surface', () => {
    const html = buildCandidatePickerDocument([]);
    expect(html).toContain('aria-label="Pick windows directly"');
    expect(html).toContain("signal('select',c.id)");
    expect(html).toContain("signal('close',c.id)");
    expect(html).toContain("signal('peek',c.id)");
    expect(html).toContain("signal('direct-pick')");
    expect(html).toContain('loading=true');
  });
});
