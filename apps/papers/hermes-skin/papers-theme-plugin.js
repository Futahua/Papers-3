import { THEMES_AREA } from '@hermes/plugin-sdk'

const papersTheme = {
  name: 'papers',
  label: 'Papers',
  description: 'Original Hermes, subtly refined to sit beside Papers.',
  colors: {
    background: '#f4f2ec', foreground: '#20201e', card: '#fbfaf6', cardForeground: '#20201e',
    muted: '#e7e3da', mutedForeground: '#5c5a52', popover: '#fbfaf6', popoverForeground: '#20201e',
    primary: '#3a4a6b', primaryForeground: '#fbfaf6', secondary: '#e9e6de', secondaryForeground: '#2c2c29',
    accent: '#e4e8f0', accentForeground: '#2b3550', border: 'rgba(32, 32, 30, 0.16)',
    input: 'rgba(32, 32, 30, 0.22)', ring: '#4f6486', midground: '#4f6486', composerRing: '#4f6486',
    destructive: '#9a4c42', destructiveForeground: '#fbfaf6', sidebarBackground: '#eeebe3',
    sidebarBorder: 'rgba(32, 32, 30, 0.12)', userBubble: '#e9edf4', userBubbleBorder: 'rgba(58, 74, 107, 0.22)'
  },
  darkColors: {
    background: '#0a0a18', foreground: '#f3f0e8', card: '#111124', cardForeground: '#f3f0e8',
    muted: '#17173a', mutedForeground: '#a9a6c8', popover: '#12122c', popoverForeground: '#f3f0e8',
    primary: '#e6e1ff', primaryForeground: '#0a0a18', secondary: '#1b1b48', secondaryForeground: '#dedaf4',
    accent: '#1c1c46', accentForeground: '#e2ddf6', border: '#24244f', input: '#22224c', ring: '#9088ea',
    midground: '#9088ea', composerRing: '#9d95ef', destructive: '#c06055', destructiveForeground: '#fdf2f0',
    sidebarBackground: '#07071a', sidebarBorder: '#181840', userBubble: '#15153a', userBubbleBorder: '#2c2c66'
  },
  typography: {
    fontSans: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    fontMono: '"Cascadia Code", "JetBrains Mono", Consolas, monospace'
  }
}

const papersCss = `
:root[data-hermes-theme='papers'] {
  --dt-base-size: 0.9375rem;
  --conversation-text-font-size: 0.90625rem;
  --conversation-tool-font-size: 0.75rem;
  --conversation-caption-font-size: 0.8125rem;
  --conversation-line-height: 1.35rem;
  --conversation-caption-line-height: 1.1rem;
}
:root[data-hermes-theme='papers']:not(.dark) {
  --papers-canvas: #f4f2ec;
  --papers-ink: #20201e;
  --ui-text-primary: color-mix(in srgb, var(--papers-ink) 96%, var(--papers-canvas));
  --ui-text-secondary: color-mix(in srgb, var(--papers-ink) 78%, var(--papers-canvas));
  --ui-text-tertiary: color-mix(in srgb, var(--papers-ink) 62%, var(--papers-canvas));
  --ui-text-quaternary: color-mix(in srgb, var(--papers-ink) 46%, var(--papers-canvas));
  --ui-bg-chrome: #f4f2ec;
  --ui-bg-editor: #faf8f2;
  --ui-bg-sidebar: #efece4;
  --ui-bg-elevated: #fbfaf6;
  --ui-bg-input: #ffffff;
}
:root[data-hermes-theme='papers']:not(.dark) .theme-default-filler { display: none !important; }
`

export default {
  id: 'papers-theme',
  name: 'Papers Theme',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({ id: 'papers', area: THEMES_AREA, data: papersTheme })
    let style = document.getElementById('papers-theme-readability')
    if (!style) {
      style = document.createElement('style')
      style.id = 'papers-theme-readability'
      style.textContent = papersCss
      document.head.appendChild(style)
    }
  }
}
