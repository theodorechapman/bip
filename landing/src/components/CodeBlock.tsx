import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const LINES = [
  { tokens: [{ t: '# Install BIP CLI', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'curl', c: 'token-fn' },
    { t: ' -fsSL bip.sh | sh', c: 'text-white/70' },
  ]},
  { tokens: [] },
  { tokens: [{ t: '# Provision an agent identity', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip consent ', c: 'text-white/70' },
    { t: '--agent', c: 'token-param' },
    { t: ' my-agent-01 ', c: 'token-string' },
    { t: '--scope', c: 'token-param' },
    { t: ' auth,captcha,session,payments', c: 'token-string' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ Consent granted · agent_id=my-agent-01', c: 'token-comment' },
  ]},
  { tokens: [] },
  { tokens: [{ t: '# Authenticate to any site', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip login ', c: 'text-white/70' },
    { t: '--target', c: 'token-param' },
    { t: ' stripe.com', c: 'token-string' },
    { t: '        # AgentMail + session', c: 'token-comment' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ session issued · sha256:a3f9...c12e · ttl=86400s', c: 'token-comment' },
  ]},
  { tokens: [] },
  { tokens: [{ t: '# Pay via x402 (agent-to-agent)', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip pay ', c: 'text-white/70' },
    { t: '--target', c: 'token-param' },
    { t: ' api.service.xyz ', c: 'token-string' },
    { t: '--amount', c: 'token-param' },
    { t: ' 0.50', c: 'token-val' },
    { t: '   # x402 in-protocol', c: 'token-comment' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ 402 → paid · $0.50 USDC · resource unlocked', c: 'token-comment' },
  ]},
  { tokens: [] },
  { tokens: [{ t: '# Pay at any checkout (web)', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip pay ', c: 'text-white/70' },
    { t: '--target', c: 'token-param' },
    { t: ' shop.example.com', c: 'token-string' },
    { t: ' --card', c: 'token-param' },
    { t: ' default', c: 'token-string' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ checkout filled · Visa ···4242 · order confirmed', c: 'token-comment' },
  ]},
];

export default function CodeBlock() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.code-reveal', {
        y: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.code-reveal', start: 'top 80%' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-16 md:py-24 px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5">
      <div className="max-w-[960px] mx-auto">

        <div className="mb-8">
          <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-3">The CLI</p>
          <h2
            className="font-sans font-light leading-none tracking-normal mb-3"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}
          >
            4 commands.
            <br />
            <span className="text-white/25">Auth and payments, any surface.</span>
          </h2>
          <p className="text-white/30 font-light max-w-md leading-relaxed text-lg">
            Auth0 requires connectors. Stripe requires integrations. BIP requires neither.
          </p>
        </div>

        <div className="code-reveal">
          <div className="bg-[#040506] border border-white/6 rounded-3xl overflow-hidden">
            {/* Terminal bar */}
            <div className="flex items-center gap-1.5 px-5 py-4 border-b border-white/5">
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="ml-4 font-mono text-[13px] text-white/20">bip — terminal</span>
              <div className="ml-auto flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#05D96A] animate-pulse-slow" />
                <span className="font-mono text-xs text-[#05D96A]/50">Running</span>
              </div>
            </div>

            {/* Code */}
            <div className="p-6 md:p-8 overflow-x-auto">
              <pre className="font-mono text-base leading-8">
                {LINES.map((line, li) => (
                  <div key={li} className="flex">
                    <span className="select-none text-white/10 w-7 flex-shrink-0 text-right mr-6 text-xs leading-8">
                      {li + 1}
                    </span>
                    <span>
                      {line.tokens.length === 0
                        ? '\u00A0'
                        : line.tokens.map((tok, ti) => (
                            <span key={ti} className={tok.c}>{tok.t}</span>
                          ))}
                    </span>
                  </div>
                ))}
              </pre>
            </div>

            {/* Status bar */}
            <div className="px-6 md:px-8 pb-6 border-t border-white/5 pt-4">
              <p className="font-mono text-sm text-white/25 mb-3 tracking-[0.15em]">stdout</p>
              <div className="space-y-1.5 font-mono text-sm">
                <p style={{ color: '#05D96A', opacity: 0.65 }}>✓ CLI installed — v0.2.1-alpha</p>
                <p style={{ color: '#00D9AA', opacity: 0.65 }}>✓ agent_id=my-agent-01 provisioned · scope=auth,captcha,session,payments</p>
                <p style={{ color: '#05D96A', opacity: 0.65 }}>✓ session issued · stripe.com · authorized</p>
                <p style={{ color: '#00D9AA', opacity: 0.65 }}>✓ x402 paid · $0.50 USDC · resource unlocked</p>
                <p style={{ color: '#05D96A', opacity: 0.65 }}>✓ checkout filled · Visa ···4242 · order confirmed</p>
                <p className="text-white/20 mt-3">
                  Agent ready. Auth and payments on <span className="text-white/40">any web surface</span>.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center gap-4">
          <button className="btn-magnetic btn-slide px-7 py-3.5 bg-white text-[#07080A] rounded-full font-bold text-sm">
            curl -fsSL bip.sh | sh →
          </button>
          <button className="btn-magnetic px-7 py-3.5 border border-white/10 text-white/40 rounded-full font-medium text-sm hover:border-white/20 hover:text-white/60 transition-all duration-300">
            API reference
          </button>
        </div>

      </div>
    </section>
  );
}
