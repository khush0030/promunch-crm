/* Shared, keyboard-accessible select menus. Native values preserve form handlers. */
(() => {
  let active = null;
  let sequence = 0;
  function close(restore = false) {
    if (!active) return;
    const { trigger, menu } = active;
    trigger.setAttribute('aria-expanded', 'false');
    menu.remove();
    active = null;
    if (restore && trigger.isConnected) trigger.focus();
  }
  window.closePMSelect = close;
  window.enhancePMSelects = () => {
    document.querySelectorAll('select:not([data-enhanced])').forEach(select => {
      select.dataset.enhanced = 'true';
      const label = select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent.trim() || 'Choose option';
      const wrapper = document.createElement('span');
      wrapper.className = 'pm-select';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'pm-select-trigger';
      trigger.disabled = select.disabled;
      trigger.setAttribute('aria-label', label);
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      const menuId = 'pm-options-' + ++sequence;
      trigger.setAttribute('aria-controls', menuId);
      const value = document.createElement('span');
      value.className = 'pm-select-value';
      trigger.append(value);
      trigger.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>');
      const sync = () => { value.textContent = select.selectedOptions[0]?.textContent || 'Choose option'; };
      sync();
      select.addEventListener('change', sync);
      select.before(wrapper);
      wrapper.append(trigger, select);
      select.hidden = true;
      function open() {
        if (active?.trigger === trigger) { close(true); return; }
        close();
        const menu = document.createElement('div');
        menu.id = menuId;
        menu.className = 'pm-select-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-label', label);
        const options = [...select.options];
        options.forEach((option, index) => {
          const item = document.createElement('div');
          item.className = 'pm-select-option';
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', String(index === select.selectedIndex));
          item.setAttribute('aria-disabled', String(option.disabled));
          item.tabIndex = -1;
          item.textContent = option.textContent;
          item.addEventListener('click', () => {
            if (option.disabled) return;
            select.selectedIndex = index;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            close(true);
          });
          menu.append(item);
        });
        document.body.append(menu);
        active = { trigger, menu };
        trigger.setAttribute('aria-expanded', 'true');
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 220), innerWidth - 24);
        menu.style.width = width + 'px';
        menu.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
        const below = innerHeight - rect.bottom - 16;
        const above = rect.top - 16;
        const up = below < 180 && above > below;
        menu.style.maxHeight = Math.min(300, Math.max(80, up ? above : below)) + 'px';
        if (up) menu.style.bottom = (innerHeight - rect.top + 6) + 'px';
        else menu.style.top = (rect.bottom + 6) + 'px';
        const items = [...menu.children].filter(item => item.getAttribute('aria-disabled') !== 'true');
        (items.find(item => item.getAttribute('aria-selected') === 'true') || items[0])?.focus({ preventScroll: true });
        let search = '', lastKey = 0;
        menu.addEventListener('keydown', event => {
          const index = items.indexOf(document.activeElement);
          let next;
          if (event.key === 'ArrowDown') next = (index + 1) % items.length;
          if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = items.length - 1;
          if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
          else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); }
          else if (event.key === 'Escape') { event.preventDefault(); close(true); }
          else if (event.key === 'Tab') close(true);
          else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            search = Date.now() - lastKey > 700 ? event.key : search + event.key;
            lastKey = Date.now();
            items.find(item => item.textContent.toLowerCase().startsWith(search.toLowerCase()))?.focus();
          }
        });
      }
      trigger.addEventListener('click', event => { event.preventDefault(); open(); });
      trigger.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
      });
    });
  };
  document.addEventListener('pointerdown', event => {
    if (active && !active.menu.contains(event.target) && !active.trigger.contains(event.target)) close();
  });
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', event => {
    if (active && !active.menu.contains(event.target)) close();
  }, true);
})();
