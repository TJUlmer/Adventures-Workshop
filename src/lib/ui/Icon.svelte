<script lang="ts" module>
  /**
   * A hand-rolled icon set. Deliberately not a dependency: the app ships
   * offline and only needs a dozen glyphs. All are 24×24, stroked, and
   * inherit `currentColor`.
   */
  export const ICON_PATHS = {
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12',
    copy: 'M9 9V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3M5 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
    download: 'M12 4v11m0 0 4-4m-4 4-4-4M4 19h16',
    save: 'M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 4v5h6V4M8 20v-6h8v6',
    upload: 'M12 20V9m0 0 4 4M12 9l-4 4M4 5h16',
    chevronRight: 'm9 5 7 7-7 7',
    chevronDown: 'm5 9 7 7 7-7',
    skull: 'M12 3a7 7 0 0 0-7 7v3l2 2v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3l2-2v-3a7 7 0 0 0-7-7ZM9.5 11h.01M14.5 11h.01',
    users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a6 6 0 0 1 12 0M16 6.2a3 3 0 0 1 0 5.6M17 14.5a5.5 5.5 0 0 1 4 5.5',
    hourglass: 'M7 4h10M7 20h10M8 4c0 4 4 5 4 8s-4 4-4 8M16 4c0 4-4 5-4 8s4 4 4 8',
    card: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 9h5M8 13h8',
    sparkle: 'M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.3l-1.8-5.7L4.5 10.8 10.2 9 12 3.5Z',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 3.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.7 1.9Z',
    image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4 16l4.5-4.5a1.5 1.5 0 0 1 2 0L15 16M14 13l1.5-1.5a1.5 1.5 0 0 1 2 0L20 14M9 9h.01',
    book: 'M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V4ZM16 6h3v14h-3',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
    bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7V5Zm0 7h7a3.5 3.5 0 0 1 0 7H7v-7Z',
    italic: 'M15 5h-6M15 19H9M14 5l-4 14',
    underline: 'M7 4v6a5 5 0 0 0 10 0V4M5 20h14',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    listOrdered: 'M10 6h10M10 12h10M10 18h10M4 5h1v4M4 15h2v1.5H4V18h2M4 9h2',
    crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
    palette:
      'M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21ZM7.5 11h.01M10 7.5h.01M15 8h.01',
    wand: 'M15 4V2m0 20v-2M8.9 8.9 7.5 7.5m9 9-1.4-1.4M4 15H2m20 0h-2M8.9 21.1 7.5 22.5M3 21l9-9',
    layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 14l9 5 9-5M3 11l9 5 9-5',
    type: 'M4 6V4h16v2M12 4v16M9 20h6',
    grid: 'M4 9h16M4 15h16M9 4v16M15 4v16',
    move: 'M12 3v18M3 12h18M12 3 9 6m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3',
    eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    rotate: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
    printer: 'M7 9V4h10v5M7 18H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 15h10v5H7v-5Z'
  } as const;

  export type IconName = keyof typeof ICON_PATHS;
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    /** Rendered size in px. Inherits colour from the parent. */
    size?: number;
    strokeWidth?: number;
    /** Set when the icon carries meaning on its own. */
    label?: string;
  }

  let { name, size = 16, strokeWidth = 1.6, label }: Props = $props();
</script>

<svg
  class="icon"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : 'presentation'}
  aria-hidden={label ? undefined : 'true'}
  aria-label={label}
>
  <path d={ICON_PATHS[name]} />
</svg>

<style>
  .icon {
    flex: none;
    overflow: visible;
  }
</style>
