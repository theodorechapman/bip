import React from 'react';

type Partner = {
  name: string;
  tag: string;
  logos: string[];
  fallback: string;
};

const partners: Partner[] = [
  {
    name: 'AgentMail',
    tag: 'Email Identity',
    logos: [
      'https://files.buildwithfern.com/https://agentmail-production.docs.buildwithfern.com/d363ca57c2013e5bb6a214b0f5b9856a45f79c64065ed797328765499b71f817/assets/agentmail-favicon.ico',
      'https://api.iconify.design/simple-icons/agentmail.svg?color=%23fff',
    ],
    fallback: 'AM',
  },
  {
    name: 'hCaptcha',
    tag: 'Captcha Layer',
    logos: [
      'https://media.licdn.com/dms/image/v2/D4D12AQFkPDuWQH-5dw/article-cover_image-shrink_720_1280/article-cover_image-shrink_720_1280/0/1689307123154?e=2147483647&v=beta&t=shzNYNngZWw2Y0d6Gk55Pi197-Yrw9uhIPplkm25dxs',
      'https://www.hcaptcha.com/fonts/64da82f6bf67de1b127890b5_hcaptcha-logo-landscape.svg',
      'https://api.iconify.design/simple-icons/hcaptcha.svg?color=%23fff',
    ],
    fallback: 'HC',
  },
  {
    name: 'Convex',
    tag: 'Data Runtime',
    logos: [
      'https://camo.githubusercontent.com/ae19e6700feb05f36d3bf1d02bf9a16a8b8836c3ef84e82bcc350aac61213ee8/68747470733a2f2f7374617469632e636f6e7665782e6465762f6c6f676f2f636f6e7665782d6c6f676f2d6c696768742e737667',
      'https://api.iconify.design/simple-icons/convex.svg?color=%23fff',
    ],
    fallback: 'CX',
  },
  {
    name: 'Anthropic',
    tag: 'AI Layer',
    logos: [
      'https://api.iconify.design/simple-icons/anthropic.svg?color=%23fff',
    ],
    fallback: 'AN',
  },
  {
    name: 'Coinbase CDP',
    tag: 'Wallet',
    logos: [
      'https://static-assets.coinbase.com/ui-infra/illustration/v1/pictogram/svg/light/coinbaseLogoNavigation-4.svg',
      'https://api.iconify.design/simple-icons/coinbase.svg?color=%23fff',
    ],
    fallback: 'CB',
  },
  {
    name: 'Browser Use',
    tag: 'Session',
    logos: ['https://browser-use.com/logo-white.svg'],
    fallback: 'BU',
  },
  {
    name: 'Laminar',
    tag: 'Observability',
    logos: ['https://api.iconify.design/simple-icons/lmstudio.svg?color=%23fff'],
    fallback: 'LM',
  },
  {
    name: 'HUD',
    tag: 'Evaluation',
    logos: ['https://api.iconify.design/lucide/monitor-check.svg?color=%23fff'],
    fallback: 'HD',
  },
  {
    name: 'SuperMemory',
    tag: 'Memory',
    logos: ['https://api.iconify.design/lucide/brain.svg?color=%23fff'],
    fallback: 'SM',
  },
  {
    name: 'Dedalus Labs',
    tag: 'Research',
    logos: ['https://api.iconify.design/lucide/flask-conical.svg?color=%23fff'],
    fallback: 'DL',
  },
  {
    name: 'Daytona',
    tag: 'Dev Env',
    logos: ['https://api.iconify.design/lucide/container.svg?color=%23fff'],
    fallback: 'DT',
  },
  {
    name: 'Vercel',
    tag: 'Deploy',
    logos: ['https://api.iconify.design/simple-icons/vercel.svg?color=%23fff'],
    fallback: 'VC',
  },
  {
    name: 'VibeFlow',
    tag: 'Workflow',
    logos: ['https://api.iconify.design/lucide/workflow.svg?color=%23fff'],
    fallback: 'VF',
  },
];

function LogoImage({
  srcList,
  alt,
  fallbackLabel,
}: {
  srcList: string[];
  alt: string;
  fallbackLabel: string;
}) {
  const [srcIndex, setSrcIndex] = React.useState(0);
  const [errored, setErrored] = React.useState(false);
  const currentLogo = srcList[Math.min(srcIndex, srcList.length - 1)];

  if (errored) {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[9px] text-white/70">
        {fallbackLabel}
      </span>
    );
  }

  return (
    <img
      src={currentLogo}
      alt={alt}
      loading="lazy"
      className="h-4 w-4 object-contain"
      onError={() =>
        setSrcIndex((prev) => {
          const nextIndex = prev + 1;

          if (nextIndex >= srcList.length) {
            setErrored(true);
            return prev;
          }

          return nextIndex;
        })
      }
    />
  );
}

export default function TrustBar() {
  const marqueePartners = [...partners, ...partners];

  return (
    <section className="py-16 px-6 sm:px-8 md:px-16 lg:px-24 bg-[#07080A] border-b border-white/5">
      <div className="max-w-[960px] mx-auto">
        <p className="font-pixel text-sm text-white/40 tracking-[0.3em] text-center mb-8">
          Powered by
        </p>
        <div className="marquee">
          <div className="marquee-track">
            {marqueePartners.map((p, i) => (
              <article
                key={`${p.name}-${i}`}
                className="marquee-item px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.02] flex items-center gap-2 whitespace-nowrap"
                >
                <span className="inline-flex h-7 w-7 rounded-full border border-white/15 bg-white/8 items-center justify-center">
                  <LogoImage srcList={p.logos} alt={`${p.name} logo`} fallbackLabel={p.fallback} />
                </span>
                <span className="font-sans text-sm text-white/85 leading-none">{p.name}</span>
                <span className="font-mono text-xs text-white/35">/ {p.tag}</span>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
