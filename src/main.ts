import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// Right-click: no browser context menu in a desktop app.
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('input, textarea')) e.preventDefault();
});

const app = mount(App, { target: document.getElementById('app')! });
export default app;
