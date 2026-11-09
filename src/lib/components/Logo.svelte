<script lang="ts">
  let { size = 24 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
  <defs>
    <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6b7bff" />
      <stop offset="1" stop-color="#3a3fc9" />
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="108" fill="url(#lg-bg)" />
  <rect x="112" y="124" width="168" height="76" rx="22" fill="#fff" fill-opacity=".92" />
  <rect x="164" y="218" width="236" height="76" rx="22" fill="#ffc857" />
  <rect x="112" y="312" width="132" height="76" rx="22" fill="#fff" fill-opacity=".92" />
  <rect x="268" y="312" width="132" height="76" rx="22" fill="#fff" fill-opacity=".55" />
  <path d="M340 256l14 14 28-30" fill="none" stroke="#3a3fc9" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
</svg>
