import type { Config } from 'tailwindcss';

const ch = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: ch('bg'), foreground: ch('text'), card: ch('panel'), deep: ch('deep'), steel: ch('steel'),
        muted: { DEFAULT: ch('steel'), foreground: ch('muted') },
        border: ch('line'), line: ch('line'), input: ch('line'), ring: ch('arc'), silver: ch('silver'),
        primary: { DEFAULT: ch('arc'), foreground: ch('on-arc') },
        arc: { DEFAULT: ch('arc'), ink: ch('arc-ink') },
        accent: { DEFAULT: ch('copper'), foreground: 'rgb(27 34 40 / <alpha-value>)' },
        copper: ch('copper'),
        destructive: { DEFAULT: ch('err'), foreground: 'rgb(27 34 40 / <alpha-value>)' },
        ok: ch('ok'), success: ch('ok'), warn: ch('warn'), err: ch('err'),
      },
      // Design-system radii: 8 / 12 / 20 / full
      borderRadius: { sm: '8px', md: '12px', lg: '20px' },
      fontFamily: { sans: ['var(--font-sans)'], display: ['var(--font-display)'], mono: ['var(--font-mono)'] },
      // Max three weights per page: 400 / 600 / 700.
      fontWeight: { medium: '600', semibold: '600', bold: '700' },
      transitionTimingFunction: { brand: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      transitionDuration: { fast: '120ms', base: '240ms', slow: '480ms' },
      keyframes: { pulseNode: { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.4)' } }, draw: { to: { strokeDashoffset: '0' } } },
      animation: { 'node-pulse': 'pulseNode 1.2s ease-in-out infinite', draw: 'draw 480ms cubic-bezier(.2,.8,.2,1) forwards' },
    },
  },
  plugins: [],
};
export default config;
