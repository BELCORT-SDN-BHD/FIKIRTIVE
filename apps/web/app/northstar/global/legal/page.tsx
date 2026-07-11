/* @nsPage district="全局横切" page="legal" status="draft"
   sources="现有路由(apps/web/app/privacy 等)" approvedAt="" pr="" */
"use client";

/**
 * 法务页组(privacy / terms / data-deletion)— 合规文本,纯文本排版对齐 token
 *
 * 设计降级页:三份文本共用一套 760 阅读模板(§L2 Detail / §L3 width ladder),
 * 页内 tab 井切换(§N4:--muted 井 radius 14 p 4,item radius 10,active = --card
 * + 600 + shadow-sm,←/→ roving focus)。字阶:title 24/30 · heading 20/26 ·
 * body-lg 15/22;代码样例 JetBrains Mono。文本改编自现有 live 路由。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { MockNote } from "@/components/northstar/_shared";

interface LegalSection {
  h: string;
  body: React.ReactNode[];
}

interface LegalDoc {
  id: string;
  tab: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const DOCS: LegalDoc[] = [
  {
    id: "privacy",
    tab: "Privacy",
    title: "Fikirtive privacy policy",
    updated: "Last updated 4 July 2026",
    intro: "This beta privacy notice explains the information Fikirtive uses to run your marketing workspace.",
    sections: [
      {
        h: "Information we process",
        body: [
          "Fikirtive stores account details, uploaded assets, prompts, generated media, campaign metadata, credit ledger activity, and settings needed to operate Otto and the workspace.",
          "If you connect external services such as Meta or Stripe, Fikirtive stores the tokens, identifiers, checkout events, and status data required to provide those integrations.",
        ],
      },
      {
        h: "How we use it",
        body: [
          "We use this information to authenticate you, keep workspace data scoped to your account, meter credits, generate and store media, show account activity, and debug product issues during the beta.",
          "Fikirtive does not use your private workspace content to grant another customer access to your files or campaigns. Operators may inspect limited account metadata to support, secure, and audit the service.",
        ],
      },
      {
        h: "Where your data lives",
        body: [
          "Fikirtive runs on hosted infrastructure and sub-processors: application hosting and database, file storage and networking, payments, email delivery, AI providers for Otto and generation, and Meta for connected ad accounts. Each processes only the data needed for its role.",
        ],
      },
      {
        h: "Your choices and PDPA rights",
        body: [
          "You can disconnect integrations from the Account area where supported. If you connected a Meta account, you can also request removal through Meta. See the data deletion page.",
          "Fikirtive is operated by Belcort Sdn. Bhd. (Malaysia) and handles personal data in line with the Personal Data Protection Act 2010 (PDPA). For access, correction, deletion, or export requests during the beta, email tao@belcort.com.",
        ],
      },
    ],
  },
  {
    id: "terms",
    tab: "Terms",
    title: "Fikirtive terms",
    updated: "Last updated 4 July 2026",
    intro:
      "Fikirtive is an invite-only beta marketing workspace. These terms are a plain-language summary for beta users.",
    sections: [
      {
        h: "Using Fikirtive",
        body: [
          "You are responsible for the prompts, uploaded files, brand material, campaign decisions, and external accounts you connect. Only upload content you own or have permission to use.",
          "Otto can draft marketing ideas and prepare generation or ad actions, but you remain responsible for reviewing outputs before publishing or spending on external platforms.",
        ],
      },
      {
        h: "Credits and paid actions",
        body: [
          "Fikirtive shows credit costs before paid generation actions. Credits are reserved before work starts and only charged when it finishes. Failed work is not charged.",
          "Nothing spends credits without your explicit confirmation. The confirm button always states the exact cost.",
        ],
      },
      {
        h: "Beta status",
        body: [
          "Fikirtive is in beta. Features may change, and the service may be interrupted for maintenance. We will give notice before any change that affects your stored content or balance.",
        ],
      },
      {
        h: "Contact",
        body: ["Questions about these terms: email tao@belcort.com."],
      },
    ],
  },
  {
    id: "data-deletion",
    tab: "Data deletion",
    title: "Data deletion",
    updated: "Last updated 4 July 2026",
    intro: "How Meta data deletion requests and full account deletion are handled.",
    sections: [
      {
        h: "Meta data deletion",
        body: [
          "When you remove Fikirtive from your Facebook settings, Meta notifies us and we delete the stored Meta connection and access token automatically. You receive a confirmation code from Meta that you can check on this page.",
          <React.Fragment key="code">
            This is your Meta data deletion reference. Confirmation code:{" "}
            <code className="rounded-[8px] bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
              FB-2481-0093
            </code>
            . If you believe a request was not honoured, email us with this code.
          </React.Fragment>,
        ],
      },
      {
        h: "Deleting your whole account",
        body: [
          "To delete your whole Fikirtive account and workspace data, email tao@belcort.com. We respond within 14 days.",
        ],
      },
    ],
  },
];

export default function Page() {
  const [docId, setDocId] = React.useState(DOCS[0].id);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const doc = DOCS.find((d) => d.id === docId) ?? DOCS[0];
  const activeIdx = DOCS.findIndex((d) => d.id === docId);

  // §A3:hand-rolled tablist 必须实现 ←/→ roving focus
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (activeIdx + dir + DOCS.length) % DOCS.length;
    setDocId(DOCS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 pt-6 pb-10">
      {/* §N4 tab 井:换的是“在看哪份文本” */}
      <div
        role="tablist"
        aria-label="Legal documents"
        onKeyDown={onTabKeyDown}
        className="inline-flex w-fit items-center gap-1 rounded-[14px] bg-muted p-1"
      >
        {DOCS.map((d, i) => {
          const active = d.id === docId;
          return (
            <button
              key={d.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setDocId(d.id)}
              className={cn(
                "rounded-[10px] px-4 py-2 text-[13px] transition-colors duration-[120ms]",
                active
                  ? "bg-card font-semibold text-foreground shadow-[var(--shadow-sm)]"
                  : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {d.tab}
            </button>
          );
        })}
      </div>

      {/* 760 阅读列:title 24/30 · heading 20/26 · body-lg 15/22 */}
      <article className="mt-8">
        <h1 className="text-2xl leading-[30px] font-bold tracking-[-0.02em] text-foreground">{doc.title}</h1>
        <p className="mt-2 text-xs leading-4 font-medium text-muted-foreground">{doc.updated}</p>
        <p className="mt-4 text-[15px] leading-[22px] text-muted-foreground">{doc.intro}</p>

        {doc.sections.map((s) => (
          <section key={s.h} className="mt-8">
            <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.017em] text-foreground">{s.h}</h2>
            <div className="mt-3 space-y-3">
              {s.body.map((p, i) => (
                <p key={i} className="text-[15px] leading-[22px] text-muted-foreground">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </article>

      <p className="mt-12 font-mono text-[11px] leading-[16px] tracking-[0.02em] text-muted-foreground">
        规则回执:设计降级 — 纯文本排版对齐 token,三份文本共用一套 760 阅读模板(§L2/§L3)·
        tab 井 §N4 + ←/→ roving focus(§A3)· 本页零 coral(chrome 之外)· 文本改编自现有 live 路由。
      </p>

      <MockNote path="/northstar/global/legal" />
    </div>
  );
}
