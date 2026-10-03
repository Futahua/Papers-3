const SVG_NS = 'http://www.w3.org/2000/svg';

export function createDragTrailController({ document, animate, maxMarks = 36, duration = 520 }) {
  const marks = [];
  let layer = null;

  function removeMark(mark) {
    const index = marks.indexOf(mark);
    if (index >= 0) marks.splice(index, 1);
    mark.animation?.cancel?.();
    mark.animation?.pause?.();
    mark.element.remove();
  }

  function clear() {
    for (const mark of [...marks]) removeMark(mark);
  }

  function setLayer(nextLayer) {
    layer = nextLayer;
  }

  function record(points, { color = '#3f7950' } = {}) {
    const valid = (points ?? []).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (!layer) return;
    if (valid.length === 0) {
      clear();
      return;
    }
    const center = valid.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    center.x /= valid.length;
    center.y /= valid.length;
    const element = document.createElementNS(SVG_NS, 'circle');
    element.setAttribute('class', 'graph-drag-trail-mark');
    element.setAttribute('cx', center.x);
    element.setAttribute('cy', center.y);
    element.setAttribute('r', '6.5');
    element.setAttribute('fill', color);
    element.setAttribute('pointer-events', 'none');
    layer.append(element);
    const mark = { element, animation: null };
    marks.push(mark);
    mark.animation = animate(element, {
      opacity: [0.95, 0],
      r: [6.5, 1],
      duration,
      ease: 'outQuad',
      onComplete: () => {
        if (marks.includes(mark)) removeMark(mark);
      },
    });
    while (marks.length > maxMarks) removeMark(marks[0]);
  }

  return {
    setLayer,
    record,
    clear,
    get count() { return marks.length; },
  };
}
