'use strict';

{
  const nav = document.querySelector('#primary-nav');
  const header = nav.closest('.site-header');
  const toggle = header.querySelector('.menu-toggle');
  const panel = nav.querySelector('#mega-menu');
  const triggers = [...nav.querySelectorAll('[data-menu-column]')];
  const columns = [...panel.querySelectorAll('.mega-column')];
  const mobile = matchMedia('(max-width: 900px)');
  let openMethod = '';
  let activeTrigger = null;

  function setMenu(method = '', trigger = null) {
    openMethod = method;
    activeTrigger = trigger;
    const isOpen = Boolean(method);
    panel.inert = !isOpen;
    panel.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen && mobile.matches));
    for (const button of triggers) {
      button.setAttribute('aria-expanded', String(isOpen && !mobile.matches));
    }
  }

  toggle.addEventListener('click', () => {
    if (openMethod) setMenu();
    else setMenu('button', toggle);
  });

  function focusColumn(button) {
    columns[Number(button.dataset.menuColumn)]?.querySelector('a')?.focus();
  }

  for (const button of triggers) {
    button.addEventListener('pointerenter', (event) => {
      if (!mobile.matches && event.pointerType === 'mouse' && !openMethod) setMenu('hover', button);
    });
    button.addEventListener('click', (event) => {
      if (openMethod === 'button' && activeTrigger === button && event.detail !== 0) {
        setMenu();
        return;
      }
      setMenu('button', button);
      if (event.detail === 0) focusColumn(button);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      setMenu('button', button);
      focusColumn(button);
    });
  }

  nav.addEventListener('pointerleave', () => {
    if (openMethod === 'hover' && !panel.contains(document.activeElement)) setMenu();
  });
  header.addEventListener('focusout', (event) => {
    if (!header.contains(event.relatedTarget)) setMenu();
  });
  header.querySelector('.header-action').addEventListener('focus', () => setMenu());
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#primary-nav, .menu-toggle') || event.target.closest('#mega-menu a')) {
      setMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !openMethod || document.querySelector('dialog[open]')) return;
    const trigger = activeTrigger;
    const shouldRefocus = panel.contains(document.activeElement);
    setMenu();
    if (shouldRefocus) trigger?.focus();
  });
  mobile.addEventListener('change', () => setMenu());
}
