import { describe, expect, it } from 'vitest';

import {
  buildHoverPreviewDocument,
  hoverPreviewSignature,
  placeHoverPreview,
} from '../../src/main/windows/hoverPreviewPresentation';

const preview = {
  imageUrl: 'data:image/png;base64,AAAA',
  title: 'Window <One>',
  width: 100,
  height: 80,
  anchor: { x: 100, y: 100, width: 20, height: 20 },
};

describe('hover preview presentation', () => {
  it('escapes the title and keeps the image dimensions in one document builder', () => {
    const html = buildHoverPreviewDocument(preview);
    expect(html).toContain('Window &lt;One&gt;');
    expect(html).not.toContain('Window <One>');
    expect(html).toContain('width:100px');
    expect(html).toContain('height:80px');
  });

  it('places anchor previews below then above and clamps to the display', () => {
    expect(placeHoverPreview(preview, 'anchor', { x: 0, y: 0, width: 500, height: 500 }, { x: 0, y: 0, width: 1, height: 1 }))
      .toEqual({ x: 56, y: 128, width: 108, height: 112 });

    const nearBottom = { ...preview, anchor: { x: 480, y: 470, width: 20, height: 20 } };
    expect(placeHoverPreview(nearBottom, 'anchor', { x: 0, y: 0, width: 500, height: 500 }, { x: 0, y: 0, width: 1, height: 1 }))
      .toEqual({ x: 392, y: 350, width: 108, height: 112 });
  });

  it('places widget previews relative to the whole owner, not the hovered icon', () => {
    const bounds = placeHoverPreview(
      preview,
      'widget',
      { x: 0, y: 0, width: 500, height: 500 },
      { x: 80, y: 10, width: 220, height: 150 },
    );
    expect(bounds.y).toBe(168);
  });

  it('signature changes with pixels, dimensions or title', () => {
    const a = hoverPreviewSignature(preview);
    expect(hoverPreviewSignature({ ...preview })).toBe(a);
    expect(hoverPreviewSignature({ ...preview, title: 'Other' })).not.toBe(a);
    expect(hoverPreviewSignature({ ...preview, width: 101 })).not.toBe(a);
    expect(hoverPreviewSignature({ ...preview, imageUrl: 'data:image/png;base64,BBBB' })).not.toBe(a);
  });
});
