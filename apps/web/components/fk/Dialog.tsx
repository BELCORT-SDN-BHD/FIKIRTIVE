"use client";
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: DialogProps) {
  const [closeHovered, setCloseHovered] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "dialog-title" : undefined}
      aria-describedby={description ? "dialog-description" : undefined}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28, 27, 24, 0.45)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "var(--surface-card)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-xl, var(--shadow-lg))",
          padding: "var(--space-8)",
          minWidth: "320px",
          maxWidth: "520px",
          width: "90vw",
          boxSizing: "border-box",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          onMouseEnter={() => setCloseHovered(true)}
          onMouseLeave={() => setCloseHovered(false)}
          aria-label="Close dialog"
          style={{
            position: "absolute",
            top: "var(--space-4)",
            right: "var(--space-4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: closeHovered ? "var(--text-body)" : "var(--text-faint)",
            borderRadius: "var(--radius-sm)",
            padding: "4px",
            transition: "color var(--dur-fast) var(--ease-out)",
          }}
        >
          <X size={18} />
        </button>

        {/* Title */}
        {title && (
          <h2
            id="dialog-title"
            style={{
              margin: "0 0 var(--space-2)",
              fontSize: "var(--text-xl, var(--text-lg))",
              fontWeight: "var(--weight-bold)",
              color: "var(--text-strong)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {title}
          </h2>
        )}

        {/* Description */}
        {description && (
          <p
            id="dialog-description"
            style={{
              margin: "0 0 var(--space-6)",
              fontSize: "var(--text-base)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            {description}
          </p>
        )}

        {/* Body */}
        {children}

        {/* Footer */}
        {footer && (
          <div
            style={{
              marginTop: "var(--space-6)",
              display: "flex",
              gap: "var(--gap-control)",
              justifyContent: "flex-end",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dialog;
