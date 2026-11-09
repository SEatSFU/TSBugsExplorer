/** A single, additive click/drag selection model for one benchmark criterion. */
export function createBenchmarkFacet(list, onChange) {
  const fieldset = list.closest('fieldset');
  const search = fieldset.querySelector('input[type="search"]');
  const summary = fieldset.querySelector('.selection-summary');
  const options = [...list.querySelectorAll('.criterion-option')];
  let selected = new Set(options.filter(item => item.getAttribute('aria-selected') === 'true').map(item => item.dataset.value));
  let gesture = null, animation = null, suppressClick = false;

  function sync() {
    for (const option of options) option.setAttribute('aria-selected', String(selected.has(option.dataset.value)));
    summary.textContent = selected.size ? `Selected Items: ${selected.size} / ${options.length}${selected.size === options.length ? ' (all current items selected)' : ''}` : 'No options selected';
  }
  function setSelected(values, notify = true) {
    selected = new Set(values); sync(); if (notify) onChange();
  }
  function toggle(option) {
    const value = option.dataset.value;
    if (selected.has(value)) selected.delete(value); else selected.add(value);
    sync(); onChange();
  }

  // Swept segments include intervening rows even when fast drags skip pointer events.
  function intersects(start, end, rect) {
    let min = 0, max = 1;
    for (const [axis, low, high] of [['x', rect.left, rect.right], ['y', rect.top, rect.bottom]]) {
      const delta = end[axis] - start[axis];
      if (!delta) { if (start[axis] < low || start[axis] > high) return false; }
      else {
        const a = (low - start[axis]) / delta, b = (high - start[axis]) / delta;
        min = Math.max(min, Math.min(a, b)); max = Math.min(max, Math.max(a, b));
        if (min > max) return false;
      }
    }
    return true;
  }
  function addCovered(start, end) {
    const viewport = list.getBoundingClientRect();
    let changed = false;
    for (const option of options) {
      if (option.hidden) continue;
      const box = option.getBoundingClientRect();
      const rect = { left: Math.max(box.left, viewport.left), right: Math.min(box.right, viewport.right), top: Math.max(box.top, viewport.top), bottom: Math.min(box.bottom, viewport.bottom) };
      if (rect.left < rect.right && rect.top < rect.bottom && intersects(start, end, rect) && !selected.has(option.dataset.value)) {
        selected.add(option.dataset.value); changed = true;
      }
    }
    if (changed) { sync(); onChange(); }
  }
  function autoScroll() {
    animation = null;
    if (!gesture?.dragging) return;
    const box = list.getBoundingClientRect(), point = gesture.last;
    if (point.x >= box.left && point.x <= box.right) {
      const amount = point.y < box.top + 20 ? -8 : point.y > box.bottom - 20 ? 8 : 0;
      const before = list.scrollTop;
      if (amount) list.scrollTop += amount;
      if (list.scrollTop !== before) addCovered(point, point);
    }
    animation = requestAnimationFrame(autoScroll);
  }
  function cancelGesture() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null; gesture = null;
  }

  list.addEventListener('pointerdown', event => {
    suppressClick = false;
    const option = event.target.closest('.criterion-option');
    // Touch taps use native clicks; native touch scrolling never paints selections.
    if (!option || event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
    option.focus({ preventScroll: true }); event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    gesture = { pointerId: event.pointerId, option, start: point, last: point, dragging: false };
    list.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!gesture.dragging && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < 5) return;
    if (!gesture.dragging) {
      gesture.dragging = true;
      addCovered(gesture.start, gesture.start);
      animation = requestAnimationFrame(autoScroll);
    }
    addCovered(gesture.last, point); gesture.last = point;
    event.preventDefault();
  });
  list.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.dragging) addCovered(gesture.last, { x: event.clientX, y: event.clientY });
    else toggle(gesture.option);
    cancelGesture();
    if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
    // A pointer-generated click after release must not undo the completed gesture.
    suppressClick = true;
  });
  list.addEventListener('pointercancel', cancelGesture);
  list.addEventListener('lostpointercapture', cancelGesture);
  list.addEventListener('click', event => {
    if (suppressClick && event.detail > 0) { suppressClick = false; event.preventDefault(); return; }
    const option = event.target.closest('.criterion-option');
    if (option) toggle(option); // Native keyboard clicks and touch taps.
  });
  list.addEventListener('keydown', event => {
    const visible = options.filter(option => !option.hidden), current = visible.indexOf(event.target);
    if (current < 0) return;
    const target = event.key === 'ArrowDown' ? Math.min(current + 1, visible.length - 1) : event.key === 'ArrowUp' ? Math.max(current - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : null;
    if (target !== null) { event.preventDefault(); visible[target].focus(); }
  });
  search.addEventListener('input', () => {
    cancelGesture();
    const query = search.value.toLowerCase();
    for (const option of options) option.hidden = !option.textContent.toLowerCase().includes(query);
    fieldset.querySelector('.criterion-empty').hidden = options.some(option => !option.hidden);
  });
  fieldset.querySelector('[data-select-all]').addEventListener('click', () => setSelected(options.map(option => option.dataset.value)));
  fieldset.querySelector('[data-clear]').addEventListener('click', () => setSelected([]));
  sync();
  return { values: () => [...selected], selectAll: (notify = true) => setSelected(options.map(option => option.dataset.value), notify), clear: (notify = true) => setSelected([], notify) };
}
