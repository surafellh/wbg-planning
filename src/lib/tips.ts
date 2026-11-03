/* Hover help for any element with data-tip: one floating box on top of the page, so it is never clipped by a
   scrolling table or panel. Placed below the element, or above it when there is no room; kept inside the window. */
export function installTips() {
  if (typeof document === 'undefined' || (window as any).__tips) return; (window as any).__tips = true;
  const box = document.createElement('div'); box.className = 'tiplayer'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box);
  let cur: HTMLElement | null = null;
  const hide = () => { cur = null; box.classList.remove('on'); };
  const show = (el: HTMLElement, text?: string) => {
    const t = text ?? el.getAttribute('data-tip'); if (!t) return hide(); cur = el; box.textContent = t; box.classList.add('on');
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, g = 6;
    let top = r.bottom + g; if (top + b.height > vh - 8 && r.top - g - b.height > 8) top = r.top - g - b.height;
    const left = Math.max(8, Math.min(r.left, vw - b.width - 8));
    box.style.top = Math.max(8, top) + 'px'; box.style.left = left + 'px';
  };
  // a spreadsheet or table cell whose text is cut off shows its full text on hover
  const clipped = (t: HTMLElement) => { const td = t.closest?.('.sheet td, table.t td') as HTMLElement | null; if (!td || td.querySelector('input,select')) return null;
    const over = td.scrollWidth > td.clientWidth + 1 || Array.from(td.querySelectorAll('*')).some(x => (x as HTMLElement).scrollWidth > (x as HTMLElement).clientWidth + 1 && getComputedStyle(x).textOverflow === 'ellipsis');
    const txt = (td.innerText || '').trim(); return over && txt ? { td, txt } : null; };
  document.addEventListener('mouseover', e => { const t = e.target as HTMLElement; const el = t?.closest?.('[data-tip]') as HTMLElement | null;
    if (el && !(el.tagName === 'TH' && t.closest('td'))) { if (el !== cur) show(el); return; }
    const c = t ? clipped(t) : null; if (c) { if (c.td !== cur) show(c.td, c.txt); return; } hide(); });
  document.addEventListener('focusin', e => { const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null; if (el) show(el); });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true); window.addEventListener('blur', hide);
  document.addEventListener('mousedown', hide);
}
