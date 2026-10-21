/** ShortagePledge mark: a pill bottle on a plum tile, with a green dot for "back on the shelf". */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="ShortagePledge">
      <rect width="32" height="32" rx="9" fill="#3A1F4B" />
      <rect x="10" y="6.5" width="12" height="4" rx="1.4" fill="#E8A33D" />
      <path d="M9.5 12.2c0-.9.7-1.6 1.6-1.6h9.8c.9 0 1.6.7 1.6 1.6v12.2a2.6 2.6 0 0 1-2.6 2.6h-7.8a2.6 2.6 0 0 1-2.6-2.6Z" fill="#FBF6EE" />
      <rect x="9.5" y="15" width="13" height="6.4" fill="#F3EADB" />
      <path d="M13.2 18.3h5.6M16 15.6v5.4" stroke="#3A1F4B" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="24.4" cy="24.4" r="4.4" fill="#2F8F5B" stroke="#3A1F4B" strokeWidth="1.2" />
      <path d="M22.5 24.5l1.3 1.3 2.5-2.7" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
