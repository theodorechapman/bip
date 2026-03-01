import React, { useEffect, useState } from 'react';

function BipLogo({ className = '' }: { className?: string }) {
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

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`
        fixed top-0 left-0 right-0 z-50
        py-4
        transition-all duration-400 ease-in-out
        ${scrolled
          ? 'bg-[#07080A]/92 backdrop-blur-xl border-b border-white/8'
          : 'bg-transparent border-b border-transparent'
        }
      `}
    >
      <div className="max-w-[1400px] mx-auto w-full px-8 md:px-12 lg:px-16 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="text-white hover:text-white/80 transition-colors duration-200">
          <BipLogo className="h-7 w-auto" />
        </a>

        {/* Links — center */}
        <div className="hidden md:flex items-center gap-8 text-sm">
          {[
            { label: 'Features', href: '#features' },
            { label: 'Why BIP', href: '#why-bip' },
            { label: 'Payments', href: '#payments' },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="font-mono text-xs text-white/35 hover:text-white/70 transition-colors duration-200 tracking-wide"
            >
              {label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <a
          href="#waitlist"
          className="px-5 py-2 rounded-full text-xs font-bold tracking-wide bg-white text-[#07080A] hover:bg-white/90 transition-colors duration-200"
        >
          Get access
        </a>
      </div>
    </nav>
  );
}
