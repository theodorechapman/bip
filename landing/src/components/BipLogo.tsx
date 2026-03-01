import React from 'react';

export default function BipLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 8 108 48"
      fill="none"
      aria-label="bip"
      className={className}
    >
      <text
        x="0"
        y="48"
        fontFamily="Helvetica, Arial, sans-serif"
        fontWeight="800"
        fontSize="52"
        letterSpacing="-4"
        fill="currentColor"
      >bip</text>
    </svg>
  );
}
