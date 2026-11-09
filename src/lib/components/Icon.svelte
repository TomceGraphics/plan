<script lang="ts">
  /** Original inline icon set. 24×24 grid, 1.75 stroke, round caps. */
  const P: Record<string, string> = {
    'chev-left': 'M14.5 6l-6 6 6 6',
    'chev-right': 'M9.5 6l6 6-6 6',
    'chev-down': 'M6 9.5l6 6 6-6',
    'chev-up': 'M6 14.5l6-6 6 6',
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13zM15.5 15.5L20 20',
    calendar: 'M5 6.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1zM4 10.5h16M8.5 4v4M15.5 4v4',
    tasks: 'M9.5 7H20M9.5 12H20M9.5 17H20M4.5 7l1.2 1.2L8 5.8M4.5 12l1.2 1.2L8 10.8M4.5 17l1.2 1.2L8 15.8',
    clock: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 8v4.2l2.8 1.8',
    repeat: 'M5 11V9.5A2.5 2.5 0 0 1 7.5 7H18M15.5 4.5L18 7l-2.5 2.5M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6M8.5 19.5L6 17l2.5-2.5',
    pin: 'M12 20.5s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10zM12 8.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
    note: 'M5.5 4.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM8 9h8M8 12.5h8M8 16h4.5',
    trash: 'M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7M10.2 10.5v5.5M13.8 10.5v5.5',
    sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
    sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
    moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
    sidebar: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9.5 5v14',
    flag: 'M6 20V4.5M6 5h11l-2 3.5 2 3.5H6',
    command: 'M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zM9 9h6M15 9V6.5A2.5 2.5 0 1 1 17.5 9H15zM9 9v6M15 9v6M9 15v2.5A2.5 2.5 0 1 1 6.5 15H9zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15zM9 15h6',
    subtask: 'M6 4.5v8a2 2 0 0 0 2 2h9M13.5 10.5l4 4-4 4',
    grip: 'M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01',
    keyboard: 'M4.5 7h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM7 10.5h.01M10 10.5h.01M13 10.5h.01M16 10.5h.01M8 14h8',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    bolt: 'M13 3.5L6 13.5h5l-1 7 7-10h-5l1-7z',
    inbox: 'M4 13l2-7h12l2 7M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M4 13h4.5l1 2h5l1-2H20',
    today: 'M5 6.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1zM4 10.5h16M8.5 4v4M15.5 4v4M12 13.5a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z'
  };
  let { name, size = 16, label }: { name: string; size?: number; label?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path d={P[name] ?? ''} />
</svg>
