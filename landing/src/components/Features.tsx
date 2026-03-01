import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/* ─── System log feed ────────────────────────────────────────────────────── */
function SystemFeed() {
  const events = [
    { msg: 'authenticating agent_id=my-agent-01', col: '#05D96A' },
    { msg: 'consent scope=auth,captcha verified', col: '#05D96A' },
    { msg: 'session issued target=stripe.com ttl=86400s', col: '#00D9AA' },
    { msg: 'captcha solved provider=hcaptcha t=340ms', col: '#05D96A' },
    { msg: 'x402 payment $0.50 USDC → api.service.xyz', col: '#00D9AA' },
    { msg: 'checkout fill visa ···4242 → shop.example.com', col: '#05D96A' },
    { msg: 'session refreshed target=github.com', col: '#00D9AA' },
    { msg: 'agentmail inbox=agent-01@bip.sh ready', col: '#05D96A' },
    { msg: 'quota check captcha=24/50 login=8/20', col: '#00D9AA' },
    { msg: 'agent_id=my-agent-01 status=authorized', col: '#05D96A' },
  ];

  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [cursor, setCursor] = useState(true);
  const [log, setLog] = useState<typeof events>([]);

  useEffect(() => {
    const msg = events[idx].msg;
    let i = 0;
    setTyped('');
    const t = setInterval(() => {
      if (i < msg.length) {
        setTyped(msg.slice(0, i + 1));
        i++;
      } else {
        clearInterval(t);
        setTimeout(() => {
          setLog(p => [...p.slice(-6), events[idx]]);
          setIdx(p => (p + 1) % events.length);
        }, 900);
      }
    }, 22);
    return () => clearInterval(t);
  }, [idx]);

  useEffect(() => {
    const b = setInterval(() => setCursor(c => !c), 530);
    return () => clearInterval(b);
  }, []);

  return (
    <div className="h-full flex flex-col font-mono text-xs">
      <div className="flex items-center gap-2 mb-5 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-[#05D96A] animate-pulse-slow" />
        <span className="text-[#05D96A]/70 tracking-[0.2em] text-sm">System Log · Live</span>
      </div>
      <div className="flex-1 overflow-hidden space-y-2 mb-3">
        {log.map((entry, i) => (
          <p
            key={i}
            className="truncate text-xs leading-relaxed"
            style={{ color: entry.col, opacity: 0.25 + (i / log.length) * 0.35 }}
          >
            <span className="text-white/15 mr-2 select-none">{String(i + 1).padStart(2, '0')}</span>
            {entry.msg}
          </p>
        ))}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 border-t border-white/5 pt-3">
        <span className="text-white/20 text-xs mr-1.5 select-none">›</span>
        <span className="text-xs" style={{ color: events[idx]?.col || '#05D96A' }}>{typed}</span>
        <span
          className="inline-block w-1.5 h-3 rounded-sm ml-0.5"
          style={{ background: events[idx]?.col || '#05D96A', opacity: cursor ? 0.85 : 0 }}
        />
      </div>
    </div>
  );
}

/* ─── Big stat cell ───────────────────────────────────────────────────────── */
function BigStat({ value, label, sub, color = '#05D96A' }: {
  value: string; label: string; sub: string; color?: string;
}) {
  return (
    <div className="h-full flex flex-col justify-between">
      <p className="font-mono text-sm text-white/30 tracking-[0.2em]">{label}</p>
      <div>
        <p
          className="font-mono font-bold leading-none mb-2"
          style={{ fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', color }}
        >
          {value}
        </p>
        <p className="font-mono text-sm text-white/25">{sub}</p>
      </div>
    </div>
  );
}

/* ─── Quota bars ──────────────────────────────────────────────────────────── */
function QuotaMeter() {
  const [counts, setCounts] = useState({ captcha: 24, login: 8, consent: 3, session: 12 });

  useEffect(() => {
    const id = setInterval(() => {
      setCounts(p => ({
        captcha: Math.min(50, p.captcha + (Math.random() > 0.7 ? 1 : 0)),
        login:   Math.min(20, p.login   + (Math.random() > 0.85 ? 1 : 0)),
        consent: p.consent,
        session: Math.min(30, p.session + (Math.random() > 0.8 ? 1 : 0)),
      }));
    }, 2800);
    return () => clearInterval(id);
  }, []);

  const items = [
    { label: 'captcha_solves',  used: counts.captcha, cap: 50,  col: '#00D9AA' },
    { label: 'login_attempts',  used: counts.login,   cap: 20,  col: '#05D96A' },
    { label: 'session_tokens',  used: counts.session, cap: 30,  col: '#05D96A' },
    { label: 'consent_grants',  used: counts.consent, cap: 10,  col: '#00D9AA' },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <p className="font-mono text-sm text-white/30 tracking-[0.2em]">Quota State</p>
        <span className="font-mono text-sm text-[#05D96A]/50">agent_id=my-agent</span>
      </div>
      <div className="flex-1 flex flex-col justify-around space-y-3">
        {items.map(item => (
          <div key={item.label}>
            <div className="flex justify-between items-center mb-1.5">
              <span className="font-mono text-xs text-white/25">{item.label}</span>
              <span className="font-mono text-xs" style={{ color: item.col }}>
                {item.used}/{item.cap}
              </span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-px">
              <div
                className="h-px rounded-full transition-all duration-1000"
                style={{ width: `${(item.used / item.cap) * 100}%`, background: item.col, boxShadow: `0 0 6px ${item.col}60` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Active sessions ─────────────────────────────────────────────────────── */
function SessionDisplay() {
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setBlink(b => !b), 1400);
    return () => clearInterval(id);
  }, []);

  const sessions = [
    { site: 'stripe.com',   token: 'eyJhbGci...d7Kp', ttl: '23h 44m', col: '#05D96A' },
    { site: 'github.com',   token: 'gho_Nm3q...8xYZ', ttl: '6h 12m',  col: '#00D9AA' },
    { site: 'shopify.com',  token: 'shpat_3f...c9R1', ttl: '47h 00m', col: '#05D96A' },
    { site: 'notion.so',    token: 'v02:a8f7...3kQP', ttl: '11h 30m', col: '#00D9AA' },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <p className="font-mono text-sm text-white/30 tracking-[0.2em]">Active Sessions</p>
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#05D96A', opacity: blink ? 1 : 0.3, transition: 'opacity 0.4s ease' }}
          />
          <span className="font-mono text-sm text-[#05D96A]/60">{sessions.length} active</span>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-3">
        {sessions.map(s => (
          <div
            key={s.site}
            className="border border-white/5 rounded-xl p-3 flex flex-col justify-between bg-white/[0.015]"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: s.col }} />
              <span className="font-mono text-xs text-white/50 truncate">{s.site}</span>
            </div>
            <p className="font-mono text-[11px] text-white/15 truncate mb-1">{s.token}</p>
            <span className="font-mono text-xs" style={{ color: s.col, opacity: 0.5 }}>{s.ttl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── x402 mini flow ──────────────────────────────────────────────────────── */
function X402Mini() {
  const [step, setStep] = useState(0);

  const steps = [
    { from: 'Agent', to: 'Endpoint', msg: 'GET /api/resource', col: '#FFFFFF', opacity: 0.4 },
    { from: 'Endpoint', to: 'Agent', msg: '402 Payment Required', col: '#05D96A', opacity: 0.9 },
    { from: 'Agent', to: 'BIP', msg: 'bip pay --x402', col: '#00D9AA', opacity: 0.9 },
    { from: 'BIP', to: 'Endpoint', msg: '$0.50 USDC', col: '#05D96A', opacity: 0.9 },
    { from: 'Endpoint', to: 'Agent', msg: '200 OK', col: '#FFFFFF', opacity: 0.55 },
  ];

  useEffect(() => {
    const id = setInterval(() => {
      setStep(p => (p + 1) % (steps.length + 2));
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const activeSteps = steps.slice(0, Math.min(step, steps.length));

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-[#05D96A] animate-pulse-slow" />
        <span className="text-[#05D96A]/70 tracking-[0.2em] text-sm">x402 · Live</span>
      </div>
      <div className="flex-1 space-y-2 font-mono text-sm">
        {activeSteps.map((s, i) => (
          <div key={i} className="flex items-center gap-2" style={{ opacity: s.opacity, color: s.col }}>
            <span className="w-14 text-right text-xs text-white/25 flex-shrink-0">{s.from}</span>
            <span className="text-white/15">→</span>
            <span className="w-14 text-xs text-white/25 flex-shrink-0">{s.to}</span>
            <span className="text-white/10 flex-shrink-0">│</span>
            <span className="truncate text-xs">{s.msg}</span>
          </div>
        ))}
        {step > steps.length && (
          <div className="pt-2 border-t border-white/5">
            <span className="text-[#05D96A]/60 text-xs">done · no form, no human</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Checkout fill mini ──────────────────────────────────────────────────── */
function CheckoutMini() {
  const fields = [
    { label: 'Card', value: '4111 ···· 1111', col: '#00D9AA' },
    { label: 'CVV', value: '···', col: '#00D9AA' },
    { label: 'Exp', value: '12/27', col: '#00D9AA' },
    { label: 'Zip', value: '94105', col: '#00D9AA' },
  ];

  const [filled, setFilled] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFilled(p => (p >= fields.length ? 0 : p + 1));
    }, 900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-[#00D9AA] animate-pulse-slow" />
        <span className="text-[#00D9AA]/70 tracking-[0.2em] text-sm">Checkout · Live</span>
      </div>
      <div className="flex-1 space-y-2.5 font-mono text-sm">
        {fields.map((f, i) => (
          <div key={f.label} className="flex items-center gap-3">
            <span className="text-white/20 w-10 flex-shrink-0 text-xs">{f.label}</span>
            <div className="flex-1 bg-white/4 rounded px-2.5 py-1.5 border border-white/5">
              <span
                className="transition-all duration-500 text-xs"
                style={{
                  color: i < filled ? f.col : 'transparent',
                  opacity: i < filled ? 0.7 : 0,
                }}
              >
                {f.value}
              </span>
            </div>
          </div>
        ))}
        {filled >= fields.length && (
          <div className="pt-2 border-t border-white/5">
            <span className="text-[#00D9AA]/60 text-xs">done · Visa ···4242 · confirmed</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Auth surfaces tag cloud ─────────────────────────────────────────────── */
function AuthSurfaces() {
  const sites = [
    'stripe.com', 'github.com', 'shopify.com', 'notion.so',
    'vercel.com', 'linear.app', 'figma.com', 'twilio.com',
    'sendgrid.com', 'cloudflare.com', 'aws.amazon.com', 'any-site.com',
  ];

  return (
    <div className="h-full flex flex-col">
      <p className="font-mono text-sm text-white/30 tracking-[0.2em] mb-5">Auth + Pay Surfaces</p>
      <div className="flex-1 flex flex-wrap gap-2 content-start">
        {sites.map((site, i) => (
          <span
            key={site}
            className="font-mono text-xs px-3 py-1.5 rounded-full border"
            style={{
              color: i === sites.length - 1 ? '#05D96A' : 'rgba(255,255,255,0.3)',
              borderColor: i === sites.length - 1 ? '#05D96A40' : 'rgba(255,255,255,0.06)',
              background: i === sites.length - 1 ? '#05D96A10' : 'transparent',
            }}
          >
            {site}
          </span>
        ))}
      </div>
      <p className="font-mono text-xs text-white/15 mt-4 pt-4 border-t border-white/5">
        + any web surface with an auth flow or checkout
      </p>
    </div>
  );
}


/* ─── Main section ────────────────────────────────────────────────────────── */
export default function Features() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.bento-cell', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.bento-grid', start: 'top 78%' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const cellCls = 'bento-cell border border-white/6 rounded-3xl p-6 bg-white/[0.015] hover:border-white/10 transition-colors duration-300 overflow-hidden';

  return (
    <section id="features" ref={sectionRef} className="py-16 md:py-24 px-8 md:px-16 lg:px-24 bg-[#0A0B0D]">
      <div className="max-w-[1100px] mx-auto">

        <div className="mb-8">
          <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-3">Primitives</p>
          <h2
            className="font-sans font-light leading-none tracking-normal"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}
          >
            Auth and payments.
            <br />
            <span className="text-white/25">One runtime.</span>
          </h2>
        </div>

        {/* Bento grid */}
        <div className="bento-grid grid grid-cols-12 auto-rows-[200px] gap-4">

          {/* System log — tall left column */}
          <div className={`${cellCls} col-span-12 md:col-span-7 row-span-2`}>
            <SystemFeed />
          </div>

          {/* Speed stat */}
          <div className={`${cellCls} col-span-6 md:col-span-3`}>
            <BigStat value="340ms" label="Captcha Solve" sub="avg. resolution time" color="#00D9AA" />
          </div>

          {/* Surfaces stat */}
          <div className={`${cellCls} col-span-6 md:col-span-2`}>
            <BigStat value="∞" label="Surfaces" sub="any web surface" color="#05D96A" />
          </div>

          {/* x402 stat */}
          <div className={`${cellCls} col-span-6 md:col-span-3`}>
            <BigStat value="$0" label="Checkout UX" sub="no forms needed" color="#05D96A" />
          </div>

          {/* Human ops */}
          <div className={`${cellCls} col-span-6 md:col-span-2`}>
            <BigStat value="0" label="Human Ops" sub="needed per task" color="#00D9AA" />
          </div>

          {/* x402 flow — left */}
          <div className={`${cellCls} col-span-12 md:col-span-5 row-span-2`}>
            <X402Mini />
          </div>

          {/* Checkout fill — right */}
          <div className={`${cellCls} col-span-12 md:col-span-7 row-span-2`}>
            <SessionDisplay />
          </div>

          {/* Sessions + Quota row */}
          <div className={`${cellCls} col-span-12 md:col-span-7 row-span-2`}>
            <CheckoutMini />
          </div>

          <div className={`${cellCls} col-span-12 md:col-span-5 row-span-2`}>
            <QuotaMeter />
          </div>

          {/* Auth surfaces — full width bottom */}
          <div className={`${cellCls} col-span-12`}>
            <AuthSurfaces />
          </div>

        </div>

      </div>
    </section>
  );
}
