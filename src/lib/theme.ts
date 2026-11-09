import type { ThemeSetting } from './types';

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let current: ThemeSetting = 'system';

function apply() {
  const dark = current === 'dark' || (current === 'system' && !!mq?.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export function setTheme(t: ThemeSetting) {
  current = t;
  apply();
}

mq?.addEventListener('change', () => {
  if (current === 'system') apply();
});
