export default function CovaiLogo({ size = 24, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7.5"
        fill="#0A0C10"
        stroke="#2A3244"
        strokeWidth="1.5"
      />
      <path
        d="M8.5 16H14.2L19.8 10.5H23"
        stroke="#38BDF8"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.2 16L19.8 21.5H23"
        stroke="#F1F5F9"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="16" r="2.2" fill="#F1F5F9" />
      <circle cx="23" cy="10.5" r="2.2" fill="#38BDF8" />
      <circle cx="23" cy="21.5" r="2.2" fill="#F1F5F9" />
    </svg>
  );
}
