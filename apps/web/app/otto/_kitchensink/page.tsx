"use client";

import "../otto-theme.css";
import React, { useState } from "react";
import {
  Button,
  IconButton,
  Badge,
  Avatar,
  OttoAvatar,
  Card,
  Tabs,
  Input,
  Textarea,
  Select,
  Checkbox,
  Switch,
  ProgressBar,
  Toast,
  Tooltip,
  Dialog,
} from "@/components/fk";
import { ArrowUp, Download, Copy, Pencil, Plus, Sparkles } from "lucide-react";

const sectionStyle: React.CSSProperties = {
  marginBottom: "var(--space-12)",
};

const headingStyle: React.CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-caps)",
  marginBottom: "var(--space-4)",
  borderBottom: "1px solid var(--border-subtle)",
  paddingBottom: "var(--space-2)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-3)",
  alignItems: "center",
};

const colStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

export default function KitchenSinkPage() {
  const [tabValue, setTabValue] = useState("otto");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [toggled, setToggled] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [textareaVal, setTextareaVal] = useState("");
  const [selectVal, setSelectVal] = useState("");

  return (
    <div
      className="fk"
      style={{
        padding: "var(--space-12) var(--space-8)",
        maxWidth: "var(--container-max)",
        margin: "0 auto",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-3xl)",
          fontWeight: "var(--weight-bold)",
          color: "var(--text-strong)",
          marginBottom: "var(--space-2)",
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        FIKIRTIVE design system
      </h1>
      <p
        style={{
          fontSize: "var(--text-lg)",
          color: "var(--text-muted)",
          marginBottom: "var(--space-12)",
        }}
      >
        Kitchen sink — all 16 fk components, every variant and size.
      </p>

      {/* Buttons */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Button</p>
        <div style={colStyle}>
          <div style={rowStyle}>
            <Button variant="primary" size="md">
              Primary md
            </Button>
            <Button variant="primary" size="sm">
              Primary sm
            </Button>
            <Button
              variant="primary"
              size="md"
              leftIcon={<Sparkles size={16} />}
            >
              With left icon
            </Button>
            <Button
              variant="primary"
              size="md"
              rightIcon={<ArrowUp size={16} />}
            >
              Let's go
            </Button>
            <Button variant="primary" size="md" disabled>
              Disabled
            </Button>
          </div>
          <div style={rowStyle}>
            <Button variant="secondary" size="md">
              Secondary md
            </Button>
            <Button variant="secondary" size="sm">
              Secondary sm
            </Button>
            <Button variant="soft" size="md" leftIcon={<Download size={16} />}>
              Download
            </Button>
            <Button variant="soft" size="sm">
              Soft sm
            </Button>
          </div>
          <div style={rowStyle}>
            <Button variant="ghost" size="md" leftIcon={<Pencil size={16} />}>
              Edit by hand
            </Button>
            <Button variant="ghost" size="sm">
              Ghost sm
            </Button>
          </div>
        </div>
      </section>

      {/* IconButton */}
      <section style={sectionStyle}>
        <p style={headingStyle}>IconButton</p>
        <div style={rowStyle}>
          <IconButton variant="primary" size="md" label="Add">
            <Plus size={18} />
          </IconButton>
          <IconButton variant="secondary" size="md" label="Download">
            <Download size={18} />
          </IconButton>
          <IconButton variant="soft" size="sm" label="Copy">
            <Copy size={16} />
          </IconButton>
          <IconButton variant="ghost" size="md" label="Edit">
            <Pencil size={18} />
          </IconButton>
        </div>
      </section>

      {/* Badge */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Badge</p>
        <div style={rowStyle}>
          <Badge variant="default">Default</Badge>
          <Badge variant="brand">Brand</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="accent">Coral</Badge>
        </div>
      </section>

      {/* Avatar */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Avatar</p>
        <div style={rowStyle}>
          <Avatar name="Wren Nakamura" size="lg" />
          <Avatar name="Sam Obi" size="md" />
          <Avatar name="Jo" size="sm" />
          <Avatar size="md" />
          <Avatar
            src="https://i.pravatar.cc/56"
            name="Someone"
            size="lg"
          />
        </div>
      </section>

      {/* OttoAvatar */}
      <section style={sectionStyle}>
        <p style={headingStyle}>OttoAvatar</p>
        <div style={rowStyle}>
          <OttoAvatar size={76} state="idle" />
          <OttoAvatar size={76} state="thinking" />
          <OttoAvatar size={40} state="thinking" />
        </div>
      </section>

      {/* Card */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Card</p>
        <div style={rowStyle}>
          <Card variant="default" padding="md" style={{ maxWidth: 280 }}>
            <p
              style={{
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-strong)",
                marginBottom: "var(--space-2)",
              }}
            >
              Default card
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              White surface with soft warm shadow.
            </p>
          </Card>
          <Card variant="tint" padding="md" style={{ maxWidth: 280 }}>
            <p
              style={{
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-strong)",
                marginBottom: "var(--space-2)",
              }}
            >
              Tint card
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              Slate-tinted surface for highlights.
            </p>
          </Card>
          <Card variant="default" padding="lg" style={{ maxWidth: 280 }}>
            <p
              style={{
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-strong)",
                marginBottom: "var(--space-2)",
              }}
            >
              Large padding
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              More breathing room inside.
            </p>
          </Card>
        </div>
      </section>

      {/* Tabs */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Tabs</p>
        <Tabs
          items={[
            { value: "otto", label: "Otto" },
            { value: "stuff", label: "My stuff" },
            { value: "memory", label: "Memory" },
            { value: "account", label: "Account" },
          ]}
          value={tabValue}
          onChange={setTabValue}
        />
        <p
          style={{
            marginTop: "var(--space-3)",
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
          }}
        >
          Active: {tabValue}
        </p>
      </section>

      {/* Input */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Input</p>
        <div style={{ ...colStyle, maxWidth: 400 }}>
          <Input
            label="Campaign name"
            placeholder="Tell me what you're promoting"
            hint="Keep it short — I'll fill in the details."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
          />
          <Input
            label="With error"
            placeholder="Something went wrong"
            error="That name's already taken. Try another."
            value=""
            onChange={() => {}}
          />
          <Input
            label="With left icon"
            placeholder="Search your campaigns"
            leftIcon={<Sparkles size={16} />}
            value=""
            onChange={() => {}}
          />
        </div>
      </section>

      {/* Textarea */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Textarea</p>
        <div style={{ maxWidth: 400 }}>
          <Textarea
            label="Brand notes"
            placeholder="Tell me about your brand — tone, audience, what makes you different."
            hint="The more you share, the better I can help."
            rows={4}
            value={textareaVal}
            onChange={(e) => setTextareaVal(e.target.value)}
          />
        </div>
      </section>

      {/* Select */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Select</p>
        <div style={{ maxWidth: 300 }}>
          <Select
            label="Campaign goal"
            placeholder="Choose a goal"
            options={[
              { value: "awareness", label: "Build awareness" },
              { value: "traffic", label: "Drive traffic" },
              { value: "leads", label: "Get leads" },
              { value: "sales", label: "Make sales" },
            ]}
            value={selectVal}
            onChange={setSelectVal}
          />
        </div>
      </section>

      {/* Checkbox */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Checkbox</p>
        <div style={colStyle}>
          <Checkbox
            checked={checked}
            onChange={setChecked}
            label="I've reviewed the plan and it looks good"
          />
          <Checkbox
            checked={true}
            onChange={() => {}}
            label="Pre-checked example"
          />
          <Checkbox
            checked={false}
            onChange={() => {}}
            label="Disabled checkbox"
            disabled
          />
        </div>
      </section>

      {/* Switch */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Switch</p>
        <div style={colStyle}>
          <Switch
            checked={toggled}
            onChange={setToggled}
            label="Send me campaign updates"
          />
          <Switch
            checked={true}
            onChange={() => {}}
            label="Always on (example)"
          />
          <Switch
            checked={false}
            onChange={() => {}}
            label="Disabled switch"
            disabled
          />
        </div>
      </section>

      {/* ProgressBar */}
      <section style={sectionStyle}>
        <p style={headingStyle}>ProgressBar</p>
        <div style={{ ...colStyle, maxWidth: 400 }}>
          <ProgressBar value={72} tone="teal" showValue={true} />
          <ProgressBar value={45} tone="brand" showValue={true} />
          <ProgressBar value={88} tone="success" showValue={true} />
          <ProgressBar value={30} tone="accent" showValue={true} />
        </div>
      </section>

      {/* Toast */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Toast</p>
        <div style={colStyle}>
          <Toast
            variant="success"
            title="Campaign saved"
            description="Your changes are safe."
            onClose={() => {}}
          />
          <Toast
            variant="warning"
            title="One scene didn't render"
            description="You weren't charged for it. Want me to retry?"
            onClose={() => {}}
          />
          <Toast
            variant="error"
            title="Generation failed"
            description="Hmm, that didn't work. Let me try again."
            onClose={() => {}}
          />
          <Toast
            variant="info"
            title="New feature"
            description="You can now download your ad as an MP4."
          />
        </div>
      </section>

      {/* Tooltip */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Tooltip</p>
        <div style={rowStyle}>
          <Tooltip content="Primary action" side="top">
            <Button variant="primary" size="sm">
              Hover me (top)
            </Button>
          </Tooltip>
          <Tooltip content="Download your ad" side="bottom">
            <IconButton variant="soft" size="md" label="Download">
              <Download size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Left side tooltip" side="left">
            <Badge variant="brand">Left</Badge>
          </Tooltip>
          <Tooltip content="Right side tooltip" side="right">
            <Badge variant="accent">Right</Badge>
          </Tooltip>
        </div>
      </section>

      {/* Dialog */}
      <section style={sectionStyle}>
        <p style={headingStyle}>Dialog</p>
        <Button variant="secondary" size="md" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Ready to launch?"
          description="Your campaign looks great. Once you approve, I'll start generating your assets — it usually takes about a minute."
          footer={
            <>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setDialogOpen(false)}
              >
                Not yet
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setDialogOpen(false)}
              >
                Yes, let's go
              </Button>
            </>
          }
        >
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              background: "var(--surface-sunken)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-3)",
            }}
          >
            3 ad variants · 4 scenes each · estimated cost: $1.20
          </p>
        </Dialog>
      </section>
    </div>
  );
}
