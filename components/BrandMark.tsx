/**
 * Shield logo SVG — single source of truth so every page renders an
 * identical brand mark. The login page used to inline this; both the
 * dashboard top-nav and the login page now share this component so a
 * future tweak to the logo updates everywhere at once.
 */
type Props = { size?: number };

export default function BrandMark({ size = 36 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="bm-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="bm-check" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <path
        d="M19 3 L31 8 L31 18 C31 26 25.5 32 19 35 C12.5 32 7 26 7 18 L7 8 Z"
        fill="url(#bm-shield)"
        opacity="0.95"
      />
      <path
        d="M19 6 L28.5 10 L28.5 18 C28.5 24.5 24 29.5 19 32 C14 29.5 9.5 24.5 9.5 18 L9.5 10 Z"
        fill="#0b0f1a"
        opacity="0.5"
      />
      <polyline
        points="13.5 19 17.5 23.5 25 14.5"
        stroke="url(#bm-check)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
