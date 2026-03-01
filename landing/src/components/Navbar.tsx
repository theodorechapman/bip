import React, { useEffect, useState } from 'react';

import BipLogo from './BipLogo';

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
      <div className="max-w-[1400px] mx-auto w-full px-6 sm:px-8 md:px-12 lg:px-16 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center">
        {/* Logo */}
        <a href="/#hero" className="text-white hover:text-white/80 transition-colors duration-200" aria-label="BIP home">
          <BipLogo className="h-7 w-auto" />
        </a>

        {/* Links — center */}
        <div className="hidden md:flex items-center gap-8 text-sm justify-center">
          {[
            { label: 'Features', href: '/#features' },
            { label: 'Why BIP', href: '/#why-bip' },
            { label: 'Payments', href: '/#payments' },
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
          href="/#waitlist"
          className="px-5 py-2 rounded-full text-xs font-light tracking-wide bg-white text-[#07080A] hover:bg-white/90 transition-colors duration-200"
        >
          Get access
        </a>
      </div>
    </nav>
  );
}
