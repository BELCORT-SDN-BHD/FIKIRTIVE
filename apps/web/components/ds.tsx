"use client";

/**
 * TypeScript port of the "Artlio Studio" prototype's design-system components
 * (AL.*) and icon set. DOM structure and classNames match the DS bundle
 * verbatim so the CSS recipes in globals.css render pixel-faithfully.
 */
import { useEffect, useRef, useState } from "react";

/* ---------------- icons (Lucide-style, 1.75 stroke) ---------------- */
function mkIcon(nodes: React.ReactNode) {
  return function Icon({ size = 18, style, ...rest }: { size?: number; style?: React.CSSProperties } & React.SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
        strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden {...rest}>
        {nodes}
      </svg>
    );
  };
}

export const IcClapper = mkIcon(<>
  <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
  <path d="m6.2 5.3 3.1 3.9" /><path d="m12.4 3.4 3.1 4" /><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
</>);
export const IcAt = mkIcon(<>
  <circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
</>);
export const IcFolder = mkIcon(
  <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
);
export const IcPlus = mkIcon(<><path d="M5 12h14" /><path d="M12 5v14" /></>);
export const IcImage = mkIcon(<>
  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" />
  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
</>);
export const IcCheck = mkIcon(<path d="M20 6 9 17l-5-5" />);
export const IcChevronDown = mkIcon(<path d="m6 9 6 6 6-6" />);
export const IcX = mkIcon(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>);
export const IcUser = mkIcon(<><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>);
export const IcFilm = mkIcon(<>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <path d="M7 3v18" /><path d="M17 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" />
  <path d="M3 16.5h4" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />
</>);

/* redesign-shell nav icons (Artlio Studio design, paths from the prototype) */
export const IcSparkle = mkIcon(<>
  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  <path d="M20 3v4" /><path d="M22 5h-4" />
</>);
export const IcCanvas = mkIcon(<>
  <path d="M22 6H2" /><path d="M22 18H2" /><path d="M6 2v20" /><path d="M18 2v20" />
</>);
export const IcStoryboard = mkIcon(<>
  <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
  <path d="m6.2 5.3 3.1 3.9" /><path d="m12.4 3.4 3.1 4" />
  <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
</>);
export const IcAssets = mkIcon(<>
  <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
</>);
export const IcPlans = mkIcon(<>
  <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
</>);
export const IcUndo = mkIcon(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a6 6 0 0 1 0 12h-3" /></>);
export const IcRedo = mkIcon(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a6 6 0 0 0 0 12h3" /></>);
export const IcExport = mkIcon(<><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14a2 2 0 0 0 2-2v-4" /></>);
export const IcUsers = mkIcon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>);
export const IcRetry = mkIcon(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>);
export const IcPlay = mkIcon(<path d="m6 3 14 9-14 9V3Z" />);

/* ---------------- primitives ---------------- */
export function MonoLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span className="mono-label" style={style}>{children}</span>;
}

export function Wordmark() {
  return (
    <span className="wordmark">
      artlio<span className="wordmark-dot" />
    </span>
  );
}

type ButtonProps = {
  variant?: "primary" | "glass" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  full?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "primary", size = "md", icon = null, full = false, children, ...rest }: ButtonProps) {
  return (
    <button className={`al-btn al-btn-${variant} al-btn-${size}${full ? " al-btn-full" : ""}`} {...rest}>
      {icon ? <span className="al-btn-iconslot">{icon}</span> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, size = "md", children, ...rest }: { label: string; size?: "sm" | "md" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`al-iconbtn al-iconbtn-${size}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Chip({
  selected = false,
  mono = false,
  interactive = true,
  icon = null,
  children,
  ...rest
}: {
  selected?: boolean;
  mono?: boolean;
  interactive?: boolean;
  icon?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`al-chip${selected ? " al-chip-selected" : ""}${mono ? " al-chip-mono" : ""}${interactive ? "" : " al-chip-static"}`}
      aria-pressed={interactive ? selected : undefined}
      tabIndex={interactive ? 0 : -1}
      type="button"
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  dot = false,
  mono = false,
  children,
  ...rest
}: {
  tone?: "neutral" | "positive" | "warning" | "danger" | "accent";
  dot?: boolean;
  mono?: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`al-badge${tone !== "neutral" ? ` al-badge-${tone}` : ""}${mono ? " al-badge-mono" : ""}`} {...rest}>
      {dot ? <span className="al-badge-dot" /> : null}
      {children}
    </span>
  );
}

export function GlassPanel({
  variant = "default",
  padding = 20,
  style,
  children,
  ...rest
}: {
  variant?: "default" | "raised" | "flat";
  padding?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`al-panel${variant !== "default" ? ` al-panel-${variant}` : ""}`} style={{ padding, ...style }} {...rest}>
      {children}
    </div>
  );
}

export function Dialog({
  open = false,
  title,
  onClose,
  actions = null,
  children,
}: {
  open?: boolean;
  title: string;
  onClose?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="al-dialog-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="al-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="al-dialog-head">
          <div className="al-dialog-title">{title}</div>
          {onClose ? (
            <button className="al-dialog-close" onClick={onClose} aria-label="Close">
              <IcX size={16} />
            </button>
          ) : null}
        </div>
        <div className="al-dialog-body">{children}</div>
        {actions ? <div className="al-dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Input({
  label,
  hint,
  prefix = null,
  suffix = null,
  ...rest
}: {
  label?: string;
  hint?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix">) {
  return (
    <label className="al-field">
      {label ? <span className="al-field-label">{label}</span> : null}
      <span className="al-input-wrap">
        {prefix ? <span className="al-input-affix">{prefix}</span> : null}
        <input {...rest} />
        {suffix ? <span className="al-input-affix">{suffix}</span> : null}
      </span>
      {hint ? <span className="al-field-hint">{hint}</span> : null}
    </label>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  full = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`al-seg${full ? " al-seg-full" : ""}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          className={`al-seg-item${o.value === value ? " al-seg-item-active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MediaCard({
  title,
  meta,
  src = null,
  video = false,
  ratio = "16:9",
  duration,
  statusChip,
  selected = false,
  footer = null,
  style,
  ...rest
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  src?: string | null;
  video?: boolean;
  ratio?: "16:9" | "9:16" | "1:1";
  duration?: string;
  statusChip?: React.ReactNode;
  selected?: boolean;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  const ratioClass = ratio === "9:16" ? " al-mediacard-9x16" : ratio === "1:1" ? " al-mediacard-1x1" : "";
  const [imgErrored, setImgErrored] = useState(false);
  // a new src is a fresh image — clear a stale error so a card that once 404'd can
  // show a valid replacement instead of staying stuck on the glow placeholder.
  useEffect(() => { setImgErrored(false); }, [src]);
  return (
    <div className={`al-mediacard${ratioClass}${selected ? " al-mediacard-sel" : ""}`} style={style} {...rest}>
      <div className="al-mediacard-media">
        {src && !imgErrored ? (
          video ? (
            <video src={src} muted loop playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={typeof title === "string" ? title : ""} onError={() => setImgErrored(true)} />
          )
        ) : (
          <div className="al-mediacard-glow" />
        )}
        {statusChip ? <span className="al-mediacard-chip">{statusChip}</span> : null}
        {duration ? <span className="al-mediacard-chip al-mediacard-duration">{duration}</span> : null}
      </div>
      {title || meta || footer ? (
        <div className="al-mediacard-body">
          {title ? <div className="al-mediacard-title">{title}</div> : null}
          {meta ? <div className="al-mediacard-meta">{meta}</div> : null}
          {footer ? <div className="al-mediacard-footer">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* Anchored glass menu (prototype PopMenu). side: "up" | "down". */
export interface PopItem<T> {
  value: T;
  label: React.ReactNode;
  desc?: React.ReactNode;
}

export function PopMenu<T extends string>({
  open,
  onClose,
  side = "down",
  heading,
  items,
  value,
  onSelect,
  width = 260,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  side?: "up" | "down";
  heading?: string;
  items: PopItem<T>[];
  value?: T;
  onSelect: (v: T) => void;
  width?: number;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose]);
  if (!open) return null;
  const pos = side === "up" ? { bottom: "calc(100% + 10px)" } : { top: "calc(100% + 10px)" };
  const alignPos = align === "right" ? { right: 0 } : { left: 0 };
  return (
    <div className="pop-menu fade-rise" ref={ref} style={{ ...pos, ...alignPos, width }} role="listbox">
      {heading ? (
        <div className="pop-menu-heading">
          <MonoLabel>{heading}</MonoLabel>
        </div>
      ) : null}
      {items.map((it) => (
        <div
          key={String(it.value)}
          className={`pop-item${it.value === value ? " active" : ""}`}
          role="option"
          aria-selected={it.value === value}
          onClick={() => {
            onSelect(it.value);
            onClose();
          }}
        >
          <span className="pop-item-main">
            <span className="pop-item-label">{it.label}</span>
            {it.desc ? <span className="pop-item-desc">{it.desc}</span> : null}
          </span>
          <span className="pop-item-check">{it.value === value ? <IcCheck size={15} /> : null}</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyHero({
  art = true,
  title,
  desc,
  children,
}: {
  art?: boolean;
  title: string;
  desc?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-hero fade-rise">
      {art ? (
        <div className="stack-art" aria-hidden>
          <span className="media-ph" style={{ width: 120, height: 76, left: 0, top: 28, transform: "rotate(-5deg)", opacity: 0.7 }}>
            <span className="media-ph-glow" />
          </span>
          <span className="media-ph" style={{ width: 124, height: 80, right: 0, top: 22, transform: "rotate(4deg)", opacity: 0.7 }}>
            <span className="media-ph-glow" />
          </span>
          <span className="media-ph" style={{ width: 136, height: 86, left: 32, top: 8, borderColor: "var(--line-1)" }}>
            <span className="media-ph-glow" />
          </span>
        </div>
      ) : null}
      <h1>{title}</h1>
      {desc ? <p>{desc}</p> : null}
      {children}
    </div>
  );
}
