import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-4 overflow-x-auto text-sm leading-relaxed">
      <code className="font-mono text-white/70">{children}</code>
    </pre>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="text-2xl font-light text-white mt-16 mb-6 pt-4 border-t border-white/[0.06] scroll-mt-24"
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-lg font-light text-white/80 mt-8 mb-3">{children}</h3>
  );
}

function Param({ name, type, required, children }: { name: string; type: string; required?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-white/[0.04] last:border-b-0">
      <div className="flex items-center gap-2">
        <code className="font-mono text-[#05D96A] text-sm">{name}</code>
        <span className="font-mono text-white/30 text-xs">{type}</span>
        {required && <span className="font-mono text-white/20 text-[10px] uppercase tracking-wider">required</span>}
      </div>
      {children && <p className="text-white/40 text-sm">{children}</p>}
    </div>
  );
}

function EndpointBlock({ method, path, description, auth, children }: {
  method: string;
  path: string;
  description: string;
  auth?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${method === 'POST' ? 'bg-[#05D96A]/10 text-[#05D96A]' : 'bg-blue-500/10 text-blue-400'}`}>
          {method}
        </span>
        <code className="font-mono text-sm text-white/70">{path}</code>
        {auth && <span className="font-mono text-white/20 text-[10px] ml-auto">auth required</span>}
      </div>
      <div className="px-4 py-3">
        <p className="text-white/40 text-sm mb-3">{description}</p>
        {children}
      </div>
    </div>
  );
}

function CliCommand({ command, description, options }: {
  command: string;
  description: string;
  options?: Array<{ flag: string; desc: string; default?: string }>;
}) {
  return (
    <div className="mb-6 bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <code className="font-mono text-sm text-[#05D96A]">bip {command}</code>
      </div>
      <div className="px-4 py-3">
        <p className="text-white/40 text-sm">{description}</p>
        {options && options.length > 0 && (
          <div className="mt-3 space-y-1">
            {options.map((opt) => (
              <div key={opt.flag} className="flex items-start gap-2 text-sm">
                <code className="font-mono text-white/50 shrink-0">{opt.flag}</code>
                <span className="text-white/30">
                  {opt.desc}
                  {opt.default && <span className="text-white/20"> (default: {opt.default})</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocsPage() {
  const { hash, pathname } = useLocation();

  useEffect(() => {
    // support /docs/api -> scroll to #api, /docs/cli -> scroll to #cli
    const pathAnchor = pathname.startsWith('/docs/') ? pathname.split('/docs/')[1] : null;
    const targetId = hash ? hash.slice(1) : pathAnchor;

    if (targetId) {
      const el = document.getElementById(targetId);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [hash, pathname]);

  return (
    <div className="bg-[#07080A] min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 pt-28 pb-20 px-6 sm:px-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <h1
            className="font-sans font-light text-white mb-2"
            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}
          >
            documentation
          </h1>
          <p className="text-white/30 font-light text-lg mb-4">
            everything you need to get started with bip.
          </p>

          {/* Nav pills */}
          <div className="flex gap-3 mb-12 flex-wrap">
            {[
              { label: 'quick start', href: '#quick-start' },
              { label: 'cli', href: '#cli' },
              { label: 'api', href: '#api' },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="px-4 py-1.5 rounded-full border border-white/[0.08] text-white/40 font-mono text-xs hover:border-[#05D96A]/30 hover:text-[#05D96A]/70 transition-all duration-200"
              >
                {label}
              </a>
            ))}
          </div>

          {/* ── Quick Start ─────────────────────────────────────────── */}
          <SectionHeading id="quick-start">quick start</SectionHeading>

          <p className="text-white/40 text-sm mb-6 leading-relaxed">
            get up and running in under a minute. install the cli, authenticate, and create your first intent.
          </p>

          <SubHeading>1. authenticate</SubHeading>
          <CodeBlock>{`TOKEN=$(curl -s -X POST "https://wonderful-goose-918.convex.site/auth/login" \\
  -H "content-type: application/json" \\
  -H "x-agent-id: agent-$(date +%s)" \\
  -d '{"inviteCode":"YOUR_CODE","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' \\
  | jq -r '.accessToken')`}</CodeBlock>

          <SubHeading>2. discover offerings</SubHeading>
          <CodeBlock>{`curl -s -X POST "https://wonderful-goose-918.convex.site/api/tools/offering_list" \\
  -H "authorization: Bearer $TOKEN" \\
  -d '{}' | jq '.offerings'`}</CodeBlock>

          <SubHeading>3. create an intent</SubHeading>
          <CodeBlock>{`bip intent_create --task "buy a $5 amazon gift card" --budget-usd 5`}</CodeBlock>

          <SubHeading>4. approve &amp; execute</SubHeading>
          <CodeBlock>{`bip intent_approve --intent-id <id>
bip intent_execute --intent-id <id>`}</CodeBlock>

          <SubHeading>5. check status</SubHeading>
          <CodeBlock>{`bip intent_status --intent-id <id>`}</CodeBlock>

          {/* ── CLI Commands ────────────────────────────────────────── */}
          <SectionHeading id="cli">cli commands</SectionHeading>

          <p className="text-white/40 text-sm mb-6 leading-relaxed">
            the bip cli wraps the api with local credential management. all commands support <code className="font-mono text-white/50">--json</code> for machine-readable output.
          </p>

          <SubHeading>auth</SubHeading>

          <CliCommand
            command="consent accept"
            description="accept terms of service and generate a local agent id. must be run before login."
          />

          <CliCommand
            command="consent check"
            description="check whether consent has been accepted locally."
          />

          <CliCommand
            command="login"
            description="authenticate with an invite code. stores encrypted credentials locally."
            options={[
              { flag: '--invite-code <code>', desc: 'invite code (or set BIP_INVITE_CODE env var)' },
              { flag: '--captcha-token <token>', desc: 'hcaptcha response token', default: 'test token' },
            ]}
          />

          <CliCommand
            command="logout"
            description="revoke the current session and delete local credentials."
          />

          <SubHeading>intents</SubHeading>

          <CliCommand
            command="intent_create"
            description="create a new payment intent for a task."
            options={[
              { flag: '--task <task>', desc: 'task description (required)' },
              { flag: '--budget-usd <amount>', desc: 'budget in usd', default: '5' },
              { flag: '--rail <rail>', desc: 'payment rail: auto, x402, bitrefill, card', default: 'auto' },
            ]}
          />

          <CliCommand
            command="intent_approve"
            description="approve a pending intent for execution."
            options={[
              { flag: '--intent-id <id>', desc: 'intent id (required)' },
            ]}
          />

          <CliCommand
            command="intent_execute"
            description="execute an approved intent."
            options={[
              { flag: '--intent-id <id>', desc: 'intent id (required)' },
            ]}
          />

          <CliCommand
            command="intent_status"
            description="check the current status of an intent."
            options={[
              { flag: '--intent-id <id>', desc: 'intent id (required)' },
            ]}
          />

          <CliCommand
            command="run_status"
            description="check the status of a browser-use execution run."
            options={[
              { flag: '--run-id <id>', desc: 'run id (required)' },
            ]}
          />

          <SubHeading>wallets</SubHeading>

          <CliCommand
            command="wallet_register"
            description="register an existing wallet address."
            options={[
              { flag: '--chain <chain>', desc: 'blockchain (e.g. solana)' },
              { flag: '--address <addr>', desc: 'wallet address' },
              { flag: '--label <label>', desc: 'optional label' },
            ]}
          />

          <CliCommand
            command="wallet_balance"
            description="check wallet balance."
            options={[
              { flag: '--chain <chain>', desc: 'blockchain', default: 'solana' },
            ]}
          />

          <SubHeading>agentmail</SubHeading>

          <CliCommand
            command="create_agentmail"
            description="create a new agentmail inbox for email verification flows."
            options={[
              { flag: '--email <email>', desc: 'requested inbox email address' },
            ]}
          />

          <CliCommand
            command="delete_agentmail"
            description="delete an agentmail inbox."
            options={[
              { flag: '--inbox-id <id>', desc: 'inbox id to delete' },
            ]}
          />

          <SubHeading>user</SubHeading>

          <CliCommand
            command="user retrieve"
            description="retrieve current user info including remaining api calls."
          />

          <SubHeading>config</SubHeading>

          <CliCommand
            command="config:set-base-url"
            description="set the api base url for the cli."
            options={[
              { flag: '--url <url>', desc: 'convex http actions base url' },
            ]}
          />

          {/* ── API Endpoints ───────────────────────────────────────── */}
          <SectionHeading id="api">api endpoints</SectionHeading>

          <p className="text-white/40 text-sm mb-6 leading-relaxed">
            all endpoints accept and return json. authenticated endpoints require a <code className="font-mono text-white/50">Bearer</code> token from <code className="font-mono text-white/50">/auth/login</code>. include <code className="font-mono text-white/50">X-Agent-Id</code> and <code className="font-mono text-white/50">X-CLI-Version</code> headers on all requests.
          </p>

          <SubHeading>authentication</SubHeading>

          <EndpointBlock method="POST" path="/auth/login" description="authenticate with invite code and captcha. returns a bearer token.">
            <Param name="inviteCode" type="string" required>your invite code</Param>
            <Param name="captchaToken" type="string" required>hcaptcha response token</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/auth/logout" description="revoke the current session token." auth />

          <SubHeading>tools</SubHeading>

          <EndpointBlock method="POST" path="/api/tools/user_retrieve" description="get current user info, remaining api calls." auth />

          <EndpointBlock method="POST" path="/api/tools/create_intent" description="create a new payment intent." auth>
            <Param name="task" type="string" required>task description</Param>
            <Param name="budgetUsd" type="number">budget in usd (default: 5)</Param>
            <Param name="rail" type="string">payment rail: auto, x402, bitrefill, card</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/approve_intent" description="approve a pending intent." auth>
            <Param name="intentId" type="string" required>intent id</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/execute_intent" description="execute an approved intent via browser-use." auth>
            <Param name="intentId" type="string" required>intent id</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/intent_status" description="get the current status of an intent." auth>
            <Param name="intentId" type="string" required>intent id</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/run_status" description="check the status of a browser-use run." auth>
            <Param name="runId" type="string" required>run id</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/register_wallet" description="register a wallet address." auth>
            <Param name="chain" type="string" required>blockchain (e.g. solana)</Param>
            <Param name="address" type="string" required>wallet address</Param>
            <Param name="label" type="string">optional label</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/wallet_balance" description="get wallet balance." auth>
            <Param name="chain" type="string">blockchain (default: solana)</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/wallet_deposit_address" description="get a deposit address for your wallet." auth>
            <Param name="chain" type="string">blockchain</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/wallet_generate" description="generate a new wallet." auth>
            <Param name="chain" type="string" required>blockchain</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/wallet_transfer" description="transfer funds between wallets." auth>
            <Param name="chain" type="string" required>blockchain</Param>
            <Param name="to" type="string" required>destination address</Param>
            <Param name="amount" type="number" required>amount to transfer</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/wallet_deposit" description="deposit funds into a wallet." auth>
            <Param name="chain" type="string" required>blockchain</Param>
            <Param name="amount" type="number" required>amount to deposit</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/create_agentmail" description="create an agentmail inbox." auth>
            <Param name="email" type="string" required>requested inbox email</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/delete_agentmail" description="delete an agentmail inbox." auth>
            <Param name="inboxId" type="string" required>inbox id</Param>
          </EndpointBlock>

          <EndpointBlock method="POST" path="/api/tools/offering_list" description="list available offerings/products." auth />

          <EndpointBlock method="POST" path="/api/tools/spend_summary" description="get a summary of spending activity." auth />

          <EndpointBlock method="POST" path="/api/tools/agent_bootstrap" description="bootstrap agent with initial configuration." auth />

          <EndpointBlock method="POST" path="/api/tools/secrets_get" description="retrieve stored secrets." auth>
            <Param name="key" type="string" required>secret key name</Param>
          </EndpointBlock>

          <SubHeading>webhooks</SubHeading>

          <EndpointBlock method="POST" path="/webhooks/agentmail" description="webhook endpoint for agentmail events. used internally for inbox message processing." />

          <SubHeading>discovery</SubHeading>

          <EndpointBlock method="GET" path="/skill.md" description="skill definition in markdown format. agents read this to discover available intents." />

        </div>
      </main>
      <Footer />
    </div>
  );
}
