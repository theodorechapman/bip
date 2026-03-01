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
  { tokens: [{ t: '# Accept terms & authenticate', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip consent accept', c: 'text-white/70' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ Consent granted · agent_id=a7f3...c12e', c: 'token-comment' },
  ]},
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip login ', c: 'text-white/70' },
    { t: '--invite-code', c: 'token-param' },
    { t: ' BIP-ALPHA', c: 'token-string' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ session issued · ttl=86400s · 100 api calls remaining', c: 'token-comment' },
  ]},
  { tokens: [] },
  { tokens: [{ t: '# Create a payment intent', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip intent_create ', c: 'text-white/70' },
    { t: '--task', c: 'token-param' },
    { t: ' "buy OpenRouter API key"', c: 'token-string' },
    { t: ' --budget-usd', c: 'token-param' },
    { t: ' 5', c: 'token-val' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ intent created · id=intent_9x...f2 · status=pending', c: 'token-comment' },
  ]},
  { tokens: [] },
  { tokens: [{ t: '# Approve & execute — Browser Use handles it', c: 'token-comment' }] },
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip intent_approve ', c: 'text-white/70' },
    { t: '--intent-id', c: 'token-param' },
    { t: ' intent_9x...f2', c: 'token-string' },
  ]},
  { tokens: [
    { t: '$ ', c: 'text-white/20' },
    { t: 'bip intent_execute ', c: 'text-white/70' },
    { t: '--intent-id', c: 'token-param' },
    { t: ' intent_9x...f2', c: 'token-string' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ Browser Use task started · navigating openrouter.ai', c: 'token-comment' },
  ]},
  { tokens: [
    { t: '  ', c: '' },
    { t: '✓ API key captured · secretRef=ref_k8...a1 · verified', c: 'token-comment' },
  ]},
];

export default function CodeBlock() {
  const sectionRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = React.useState(false);
  const copyTimerRef = React.useRef<number | null>(null);
  const commandText = 'curl -fsSL bip.sh | sh';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(commandText);
      setCopied(true);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

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

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  return (
    <section ref={sectionRef} className="py-16 md:py-24 px-6 sm:px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5">
      <div className="max-w-[960px] mx-auto">

        <div className="mb-8">
          <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-3">The CLI</p>
          <h2
            className="font-sans font-light leading-none tracking-normal mb-3"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}
          >
            Intent in. Result out.
            <br />
            <span className="text-white/25">Browser Use does the rest.</span>
          </h2>
          <p className="text-white/30 font-light max-w-md leading-relaxed text-lg">
            Create an intent, approve it, execute it. BIP orchestrates Browser Use to navigate sites, fill forms, and capture credentials — autonomously.
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
                <p style={{ color: '#05D96A', opacity: 0.65 }}>✓ CLI installed — v0.1.0</p>
                <p style={{ color: '#00D9AA', opacity: 0.65 }}>✓ consent accepted · agent_id=a7f3...c12e</p>
                <p style={{ color: '#05D96A', opacity: 0.65 }}>✓ logged in · 100 api calls · session ttl=86400s</p>
                <p style={{ color: '#00D9AA', opacity: 0.65 }}>✓ intent created · api_key_purchase · budget=$5.00</p>
                <p style={{ color: '#05D96A', opacity: 0.65 }}>✓ Browser Use executed · API key captured · verified</p>
                <p className="text-white/20 mt-3">
                  Agent funded. Intent executed. Credential secured by <span className="text-white/40">reference</span>.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            className="btn-magnetic btn-slide px-7 py-3.5 bg-white text-[#07080A] rounded-full font-bold text-sm"
            onClick={handleCopy}
            aria-live="polite"
          >
            {copied ? 'Copied ✅' : 'curl -fsSL bip.sh | sh →'}
          </button>
          <a
            href="/docs"
            className="btn-magnetic px-7 py-3.5 border border-white/10 text-white/40 rounded-full font-medium text-sm hover:border-white/20 hover:text-white/60 transition-all duration-300"
          >
            API reference
          </a>
        </div>

      </div>
    </section>
  );
}
