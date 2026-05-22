/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html', './public/**/*.js'],
  theme: {
    extend: {
      colors: {
        kairos: {
          void: '#0f0731',
          ink: '#1a0f4a',
          brass: '#9B773D',
          parchment: '#e8e0d4',
          soot: '#3d2e6b',
          cobalt: '#00c8ff',
          'cobalt-deep': '#0066cc',
          neon: '#ff6b1a',
          'neon-hot': '#ff9500',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Palatino Linotype', 'Book Antiqua', 'serif'],
        science: ['"Share Tech Mono"', 'ui-monospace', 'monospace'],
        body: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'kairos-radial':
          'radial-gradient(ellipse 120% 80% at 50% -20%, rgba(155,119,61,0.18) 0%, transparent 55%), radial-gradient(ellipse 80% 50% at 80% 100%, rgba(0,200,255,0.08) 0%, transparent 45%), radial-gradient(ellipse 60% 40% at 10% 90%, rgba(255,107,26,0.06) 0%, transparent 40%)',
        'kairos-grid':
          'linear-gradient(rgba(155,119,61,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(155,119,61,0.07) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '48px 48px',
      },
      boxShadow: {
        brass: '0 0 0 1px rgba(155,119,61,0.45), 0 0 24px rgba(155,119,61,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
        'cobalt-glow': '0 0 28px rgba(0,200,255,0.55), 0 0 56px rgba(0,102,204,0.35)',
        'neon-glow': '0 0 28px rgba(255,107,26,0.6), 0 0 52px rgba(255,149,0,0.3)',
      },
      keyframes: {
        'victorian-shimmer': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.85' },
        },
        'scarab-idle': {
          '0%, 100%': { transform: 'scale(1)', filter: 'brightness(1)' },
          '50%': { transform: 'scale(1.02)', filter: 'brightness(1.08)' },
        },
        'data-hit-cobalt': {
          '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0,200,255,0.7)' },
          '40%': { transform: 'scale(1.06)', boxShadow: '0 0 40px 12px rgba(0,200,255,0.45)' },
          '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(0,200,255,0)' },
        },
        'data-hit-neon': {
          '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,107,26,0.75)' },
          '40%': { transform: 'scale(1.06)', boxShadow: '0 0 40px 12px rgba(255,107,26,0.5)' },
          '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(255,107,26,0)' },
        },
        'scarab-pulse': {
          '0%, 100%': { transform: 'scale(1)', filter: 'brightness(1) drop-shadow(0 0 6px rgba(0,200,255,0.35))' },
          '50%': { transform: 'scale(1.07)', filter: 'brightness(1.15) drop-shadow(0 0 14px rgba(255,107,26,0.45))' },
        },
        'pulse-cta': {
          '0%, 100%': {
            transform: 'scale(1)',
            boxShadow:
              '0 0 0 0 rgba(155, 119, 61, 0.75), 0 0 24px rgba(155, 119, 61, 0.5), inset 0 0 20px rgba(255, 220, 160, 0.12)',
          },
          '50%': {
            transform: 'scale(1.09)',
            boxShadow:
              '0 0 0 16px rgba(155, 119, 61, 0), 0 0 56px rgba(255, 215, 140, 0.75), 0 0 100px rgba(155, 119, 61, 0.45), inset 0 0 28px rgba(255, 235, 200, 0.2)',
          },
        },
        'scarab-gold-aura': {
          '0%, 100%': {
            filter: 'brightness(1.08) drop-shadow(0 0 10px rgba(255, 215, 140, 0.75)) drop-shadow(0 0 28px rgba(155, 119, 61, 0.9))',
            transform: 'scale(1)',
          },
          '50%': {
            filter: 'brightness(1.28) drop-shadow(0 0 22px rgba(255, 235, 190, 1)) drop-shadow(0 0 48px rgba(201, 165, 106, 0.95))',
            transform: 'scale(1.07)',
          },
        },
        'scarab-unseal': {
          '0%': { transform: 'scale(0.92) rotate(-5deg)', filter: 'brightness(0.85)' },
          '35%': {
            transform: 'scale(1.18) rotate(6deg)',
            filter:
              'brightness(1.55) drop-shadow(0 0 8px rgba(255, 248, 220, 1)) drop-shadow(0 0 36px rgba(255, 215, 120, 1)) drop-shadow(0 0 64px rgba(155, 119, 61, 0.95))',
          },
          '100%': {
            transform: 'scale(1) rotate(0deg)',
            filter:
              'brightness(1.12) drop-shadow(0 0 14px rgba(255, 215, 140, 0.85)) drop-shadow(0 0 32px rgba(155, 119, 61, 0.65))',
          },
        },
        'report-prismatic': {
          '0%, 100%': { filter: 'hue-rotate(0deg) saturate(1.15)' },
          '33%': { filter: 'hue-rotate(12deg) saturate(1.35)' },
          '66%': { filter: 'hue-rotate(-8deg) saturate(1.28)' },
        },
      },
      animation: {
        'victorian-shimmer': 'victorian-shimmer 4s ease-in-out infinite',
        'scarab-idle': 'scarab-idle 3.2s ease-in-out infinite',
        'data-hit-cobalt': 'data-hit-cobalt 0.55s ease-out',
        'data-hit-neon': 'data-hit-neon 0.55s ease-out',
        'scarab-pulse': 'scarab-pulse 1.65s ease-in-out infinite',
        'pulse-cta': 'pulse-cta 1.35s ease-in-out infinite',
        'scarab-gold-aura': 'scarab-gold-aura 2.4s ease-in-out infinite',
        'scarab-unseal': 'scarab-unseal 1.15s ease-out forwards',
        'report-prismatic': 'report-prismatic 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
