/* Hover help for any element with data-tip: one floating box on top of the page, so it is never clipped by a
   scrolling table or panel. Placed below the element, or above it when there is no room; kept inside the window. */
export function installTips() {
  if (typeof document === 'undefined' || (window as any).__tips) return; (window as any).__tips = true;
  const box = document.createElement('div'); box.className = 'tiplayer'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box);
  let cur: HTMLElement | null = null;
  const hide = () => { cur = null; box.classList.remove('on'); };
  const show = (el: HTMLElement) => {
    const t = el.getAttribute('data-tip'); if (!t) return hide(); cur = el; box.textContent = t; box.classList.add('on');
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, g = 6;
    let top = r.bottom + g; if (top + b.height > vh - 8 && r.top - g - b.height > 8) top = r.top - g - b.height;
    const left = Math.max(8, Math.min(r.left, vw - b.width - 8));
    box.style.top = Math.max(8, top) + 'px'; box.style.left = left + 'px';
  };
  document.addEventListener('mouseover', e => { const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null; if (el !== cur) el ? show(el) : hide(); });
  document.addEventListener('focusin', e => { const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null; if (el) show(el); });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true); window.addEventListener('blur', hide);
  document.addEventListener('mousedown', hide);
}
