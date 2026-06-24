// The DoughNotes mark (recipe card + rolling pin). Sized by the `size` prop.
export default function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="DoughNotes" style={{ display: 'block' }}>
      <rect width="64" height="64" rx="14" fill="#4a3526" />
      <g transform="rotate(-8 32 35)">
        <rect x="17" y="22" width="30" height="29" rx="3.5" fill="#faf3e7" />
        <line x1="23" y1="32" x2="41" y2="32" stroke="#c8842a" strokeWidth="2.6" strokeLinecap="round" />
        <line x1="23" y1="38" x2="41" y2="38" stroke="#d9b06a" strokeWidth="2.6" strokeLinecap="round" />
        <line x1="23" y1="44" x2="34" y2="44" stroke="#d9b06a" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <g transform="rotate(-20 32 18)">
        <rect x="14" y="13" width="36" height="9" rx="4.5" fill="#c9a84c" />
        <rect x="7" y="16" width="9" height="3" rx="1.5" fill="#a8691c" />
        <rect x="48" y="16" width="9" height="3" rx="1.5" fill="#a8691c" />
      </g>
    </svg>
  );
}
