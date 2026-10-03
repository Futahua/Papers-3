import { createHash } from 'node:crypto';

export interface HoverPreviewDescriptor {
  imageUrl: string;
  title: string;
  width: number;
  height: number;
  anchor: { x: number; y: number; width: number; height: number };
}

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const HOVER_PREVIEW_PAD = 4;
export const HOVER_PREVIEW_TITLE_HEIGHT = 24;

export function hoverPreviewSignature(preview: HoverPreviewDescriptor): string {
  return createHash('sha256').update(preview.imageUrl).digest('hex')
    + `|${preview.width}x${preview.height}|${preview.title}`;
}

export function hoverPreviewWindowSize(preview: HoverPreviewDescriptor): { width: number; height: number } {
  return {
    width: preview.width + (HOVER_PREVIEW_PAD * 2),
    height: preview.height + HOVER_PREVIEW_TITLE_HEIGHT + (HOVER_PREVIEW_PAD * 2),
  };
}

export function placeHoverPreview(
  preview: HoverPreviewDescriptor,
  placement: 'widget' | 'anchor',
  area: PreviewRect,
  ownerBounds: PreviewRect,
): PreviewRect {
  const { width, height } = hoverPreviewWindowSize(preview);
  let x = Math.round(preview.anchor.x + (preview.anchor.width / 2) - (width / 2));
  let y: number;
  if (placement === 'anchor') {
    y = Math.round(preview.anchor.y + preview.anchor.height + 8);
    if (y + height > area.y + area.height) y = Math.round(preview.anchor.y - height - 8);
  } else {
    y = Math.round(ownerBounds.y - height - 8);
    if (y < area.y) y = Math.round(ownerBounds.y + ownerBounds.height + 8);
  }
  x = Math.max(area.x, Math.min(area.x + area.width - width, x));
  y = Math.max(area.y, Math.min(area.y + area.height - height, y));
  return { x, y, width, height };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildHoverPreviewDocument(preview: HoverPreviewDescriptor): string {
  const safeTitle = escapeHtml(preview.title);
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
    .preview{box-sizing:border-box;margin:${HOVER_PREVIEW_PAD}px;width:${preview.width}px;height:${preview.height + HOVER_PREVIEW_TITLE_HEIGHT}px;
      border:1px solid rgba(140,132,116,.72);border-radius:7px;overflow:hidden;
      background:#26231f;box-shadow:0 3px 10px rgba(0,0,0,.38);
      animation:rise 180ms cubic-bezier(.2,.8,.2,1) both}
    .title{box-sizing:border-box;height:${HOVER_PREVIEW_TITLE_HEIGHT}px;padding:5px 7px;color:#eee9df;
      font:11px/14px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    img{display:block;width:${preview.width}px;height:${preview.height}px;object-fit:contain;background:#26231f}
    @keyframes rise{from{transform:translateY(12px)}to{transform:translateY(0)}}
  </style><div class="preview"><div class="title">${safeTitle}</div><img src="${preview.imageUrl}" alt=""></div>`;
}
