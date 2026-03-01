import React from 'react';

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

const LINKS = {
  Product:    ['Overview', 'Primitives', 'Auth Flows', 'Changelog'],
  Developers: ['Docs', 'API Reference', 'CLI Reference', 'GitHub'],
  Company:    ['About', 'Blog', 'Careers'],
  Legal:      ['Privacy', 'Terms', 'Security'],
};

export default function Footer() {
  return (
    <footer className="bg-[#040506] border-t border-white/5 relative overflow-hidden">
      {/* Top glow — phosphor green */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-[#05D96A]/20 to-transparent" />

      <div className="relative z-10 max-w-[960px] mx-auto px-8 md:px-16 pt-20 pb-12">

        {/* Top row */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-12 mb-16 pb-16 border-b border-white/5">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <BipLogo className="h-8 w-auto text-white" />
              <span className="font-mono text-xs text-white/25 border border-white/8 rounded-full px-2.5 py-1">
                v0.2.1-alpha
              </span>
            </div>
            <p className="font-sans text-white/30 font-light leading-snug max-w-[260px]"
              style={{ fontSize: 'clamp(1rem, 2vw, 1.1rem)' }}>
              Browser Identity and Payments.<br />The runtime for autonomous agents.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button className="btn-magnetic btn-slide px-7 py-3 bg-white text-[#040506] rounded-full font-bold text-sm whitespace-nowrap">
              Start provisioning →
            </button>
            <button className="btn-magnetic px-7 py-3 border border-white/8 text-white/30 rounded-full font-medium text-sm hover:border-white/15 hover:text-white/50 transition-all duration-300">
              Read the docs
            </button>
          </div>
        </div>

        {/* Partners */}
        <div className="mb-16 pb-16 border-b border-white/5">
          <p className="font-mono text-xs text-white/25 tracking-[0.3em] mb-5">
            Ecosystem
          </p>
          <div className="flex flex-wrap gap-2">
            {['AgentMail', 'hCaptcha', 'Coinbase CDP', 'Convex', 'Anthropic', 'Browser Use'].map((s) => (
              <span
                key={s}
                className="font-mono text-xs text-white/30 px-3 py-1.5 rounded-full border border-white/6 hover:border-white/12 hover:text-white/40 transition-all duration-200 cursor-default"
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Link grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16 pb-16 border-b border-white/5">
          {Object.entries(LINKS).map(([cat, links]) => (
            <div key={cat}>
              <p className="font-mono text-xs text-white/30 tracking-[0.2em] mb-4">{cat}</p>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link}>
                    <a href="#" className="font-sans text-sm text-white/30 hover:text-white/60 transition-colors duration-200">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-mono text-xs text-white/25">
            © 2026 BIP · Browser Identity and Payments
          </p>

          <div className="flex items-center gap-2.5 bg-white/3 border border-white/6 rounded-full px-4 py-2">
            <span className="relative flex">
              <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-[#05D96A] opacity-50" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#05D96A]" />
            </span>
            <span className="font-mono text-xs text-white/40">All Systems Operational</span>
          </div>

          <p className="font-mono text-xs text-white/20">
            Built at a hackathon. Ships like production.
          </p>
        </div>

      </div>
    </footer>
  );
}
