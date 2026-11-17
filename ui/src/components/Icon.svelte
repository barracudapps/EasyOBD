<script lang="ts">
  // Minimal stroke icon set (24×24, currentColor) – no icon font, works offline.
  let { name, size = 20 }: { name: string; size?: number } = $props();

  const P: Record<string, string> = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h3l2-4 2 8 2-4h1',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    wave: 'M2 12h2l2-6 3 12 3-14 3 16 3-10 2 4h2',
    wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
    school: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 7h6',
    chip: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
    car: 'M5 17h14M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4h-3M3 13v4h3M7 17a2 2 0 1 0 0 .1M17 17a2 2 0 1 0 0 .1M3 13h18',
    van: 'M2 16V7a1 1 0 0 1 1-1h11l5 5h2v5h-2M2 16h2M14 6v5h7M7 16a2 2 0 1 0 0 .1M17 16a2 2 0 1 0 0 .1M9 16h6',
    motorcycle: 'M5 17a3 3 0 1 0 0-.1M19 17a3 3 0 1 0 0-.1M5 17l4-6h5l2 3h3M9 11l-1-3H6M14 11l2-4h2',
    truck: 'M2 6h11v10H2zM13 9h5l3 4v3h-8M6 18a2 2 0 1 0 0-.1M17 18a2 2 0 1 0 0-.1',
    plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
    wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
    bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
    usb: 'M12 2v14M9 5l3-3 3 3M7 10v3l5 3 5-3v-3M12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    sim: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8l6 4-6 4z',
    check: 'M5 12l5 5 9-10',
    x: 'M6 6l12 12M18 6L6 18',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7h.01',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    euro: 'M18 6a7 7 0 1 0 0 12M4 10h10M4 14h10',
    gauge: 'M12 14l4-4M3.5 18a10 10 0 1 1 17 0',
    cart: 'M3 4h2l2.5 11h11L21 7H6.5M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
    stop: 'M7 7h10v10H7z',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z',
    cube: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5',
    refresh: 'M20 11a8 8 0 0 0-15-3M4 4v4h4M4 13a8 8 0 0 0 15 3M20 20v-4h-4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
    terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
    chevron: 'M9 6l6 6-6 6',
    back: 'M15 6l-6 6 6 6',
    nose: 'M12 3c0 6-4 9-4 12a4 4 0 0 0 8 0M9 19c-1.5 0-3-1-3-2.5M15 19c1.5 0 3-1 3-2.5',
    ear: 'M7 9a5 5 0 1 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0M10 9a2 2 0 1 1 4 0',
    hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.5L8 14',
    steering: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2.5 10h7M14.5 10h7M12 14v8',
    star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z',
    trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6',
    battery: 'M3 8h15v8H3zM21 11v2M7 10v4M11 10v4',
    thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0zM12 9v7',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  };
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  style="flex-shrink:0"
>
  <path d={P[name] ?? P.info} />
</svg>
