#!/usr/bin/env node
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { prisma } from "../../packages/db/dist/src/index.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL) || /neon\.tech|sslmode=require/i.test(DATABASE_URL)) {
  throw new Error("Refusing to seed: DATABASE_URL must point at a local database.");
}

const ROOT = process.cwd();
const STORAGE_ROOT = path.join(ROOT, ".data", "storage");
const FOUNDER = "founder";
const MERCHANT = "org_qa_merchant";
const DISPLAY = 10;

const USERS = [
  {
    email: "founder.qa@example.test",
    name: "Founder QA",
    userId: "qa_user_founder",
    baId: "qa_ba_founder",
    orgId: FOUNDER,
    orgName: "Fikirtive QA founder org",
    userRole: "super-admin",
    memberRole: "owner",
    isFounder: true,
  },
  {
    email: "merchant.qa@example.test",
    name: "Merchant QA",
    userId: "qa_user_merchant",
    baId: "qa_ba_merchant",
    orgId: MERCHANT,
    orgName: "Kaia Cafe QA workspace",
    userRole: "viewer",
    memberRole: "owner",
    isFounder: false,
  },
];

const MOCK_MP4_B64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPjbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAABI8AAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAw10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAABI8AAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAQAAAACgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAASPAAAIAAABAAAAAAKFbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAOABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACMG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAfBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAQAAoABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UEBWwEQAAADABAAAAMBgPFCmWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAGY0AAAAAAAAAGHN0dHMAAAAAAAAAAQAAAA4AAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACAY3R0cwAAAAAAAAAOAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAADgAAAAEAAABMc3RzegAAAAAAAAAAAAAADgAAAu8AAAAQAAAADQAAAA0AAAANAAAAFgAAAA8AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAWAAAAFHN0Y28AAAAAAAAAAQAABBMAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMAAAAAhmcmVlAAADwm1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9NSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA5ZYiEABD//ubA+ZZafwbc99R1oDqSugXdc8hvTiAZchoeXRuHJPHxZ4eKLPkYKAAABrAIdBw/PCh5AAAADEGaJGxBD/6qVQAEDAAAAAlBnkJ4hv8AC2kAAAAJAZ5hdEM/AA3oAAAACQGeY2pDPwAN6QAAABJBmmhJqEFomUwIf//+qZYAD7kAAAALQZ6GRREsN/8AC2kAAAAJAZ6ldEM/AA3pAAAACQGep2pDPwAN6AAAABJBmqxJqEFsmUwIb//+p4QAHzAAAAALQZ7KRRUsN/8AC2kAAAAJAZ7pdEM/AA3oAAAACQGe62pDPwAN6AAAABJBmu1JqEFsmUwIZ//+nhAAekE=";

function id(prefix) {
  return `qa_${prefix}`;
}

function date(daysAgo, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setMinutes(d.getMinutes() - minutes);
  return d;
}

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encryptQaToken(plain) {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(hex ?? "")) return "qa-encrypted-token-placeholder";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hex, "hex"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

function storageKey(ownerId, contentHash, ext) {
  return `u/${ownerId}/${contentHash}.${ext}`;
}

function mimeOf(ext) {
  if (ext === "mp4") return "video/mp4";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function solidPng(seed) {
  const w = 8;
  const h = 8;
  const raw = Buffer.alloc(h * (1 + w * 3));
  const r = (seed * 73) % 256;
  const g = (seed * 151) % 256;
  const b = (seed * 211) % 256;
  for (let y = 0; y < h; y += 1) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x += 1) {
      const p = off + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBuf, data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writeLocalObject(ownerId, bytes, ext) {
  const contentHash = sha(bytes);
  const key = storageKey(ownerId, contentHash, ext);
  const file = path.join(STORAGE_ROOT, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { contentHash, key, sizeBytes: BigInt(bytes.length) };
}

async function upsert(model, where, create, update = create) {
  return prisma[model].upsert({ where, create, update });
}

async function seedIdentity() {
  for (const u of USERS) {
    await prisma.organization.upsert({
      where: { id: u.orgId },
      create: {
        id: u.orgId,
        name: u.orgName,
        slug: u.isFounder ? "qa-founder" : "qa-merchant",
        settings: {
          autoPublish: false,
          timezone: "Asia/Kuala_Lumpur",
          defaultPostTimes: ["09:00", "13:00", "20:00"],
          qaSeed: true,
        },
      },
      update: {
        name: u.orgName,
        settings: {
          autoPublish: false,
          timezone: "Asia/Kuala_Lumpur",
          defaultPostTimes: ["09:00", "13:00", "20:00"],
          qaSeed: true,
        },
      },
    });
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.userId,
        email: u.email,
        name: u.name,
        emailVerified: new Date(),
        role: u.userRole,
        activeOrgId: u.isFounder ? null : u.orgId,
      },
      update: {
        name: u.name,
        emailVerified: new Date(),
        role: u.userRole,
        activeOrgId: u.isFounder ? null : u.orgId,
      },
    });
    await prisma.betterAuthUser.upsert({
      where: { email: u.email },
      create: {
        id: u.baId,
        email: u.email,
        name: u.name,
        emailVerified: true,
        role: u.isFounder ? "super-admin" : null,
      },
      update: {
        name: u.name,
        emailVerified: true,
        role: u.isFounder ? "super-admin" : null,
      },
    });
    await prisma.membership.upsert({
      where: { userId_orgId: { userId: u.userId, orgId: u.orgId } },
      create: { id: id(`member_${u.orgId}`), userId: u.userId, orgId: u.orgId, role: u.memberRole, status: "active" },
      update: { role: u.memberRole, status: "active", deletedAt: null },
    });
    await prisma.allowedEmail.upsert({
      where: { email: u.email },
      create: { email: u.email, status: "active", invitedBy: "qa-seed" },
      update: { status: "active", invitedBy: "qa-seed" },
    });
  }
}

async function seedCredits(orgId, displayedBalance, displayedReserved) {
  const balance = displayedBalance * DISPLAY;
  const reserved = displayedReserved * DISPLAY;
  await prisma.creditAccount.upsert({
    where: { orgId },
    create: { orgId, balance, reserved },
    update: { balance, reserved },
  });
  await prisma.creditLedger.createMany({
    skipDuplicates: true,
    data: [
      {
        id: id(`ledger_${orgId}_grant`),
        orgId,
        balanceDelta: (displayedBalance + displayedReserved + 80) * DISPLAY,
        reservedDelta: 0,
        kind: "GRANT",
        source: "BETA",
        reason: "QA seed beta grant",
        idempotencyKey: `qa:grant:${orgId}`,
        createdBy: "qa-seed",
        createdAt: date(20),
      },
      {
        id: id(`ledger_${orgId}_reserve_done`),
        orgId,
        balanceDelta: -50 * DISPLAY,
        reservedDelta: 50 * DISPLAY,
        kind: "RESERVE",
        source: "SYSTEM",
        reason: "QA image batch reservation",
        refId: id(`job_${orgId}_done`),
        idempotencyKey: `qa:reserve-done:${orgId}`,
        createdBy: "qa-seed",
        createdAt: date(3),
      },
      {
        id: id(`ledger_${orgId}_settle_done`),
        orgId,
        balanceDelta: 0,
        reservedDelta: -50 * DISPLAY,
        kind: "SETTLE",
        source: "SYSTEM",
        reason: "QA image batch settled",
        refId: id(`job_${orgId}_done`),
        idempotencyKey: `qa:settle-done:${orgId}`,
        createdBy: "qa-seed",
        createdAt: date(3, -5),
      },
      {
        id: id(`ledger_${orgId}_reserve_live`),
        orgId,
        balanceDelta: -displayedReserved * DISPLAY,
        reservedDelta: displayedReserved * DISPLAY,
        kind: "RESERVE",
        source: "SYSTEM",
        reason: "QA in-flight video reservation",
        refId: id(`job_${orgId}_running`),
        idempotencyKey: `qa:reserve-live:${orgId}`,
        createdBy: "qa-seed",
        createdAt: date(0, 30),
      },
      {
        id: id(`ledger_${orgId}_adjust`),
        orgId,
        balanceDelta: -30 * DISPLAY,
        reservedDelta: 0,
        kind: "ADJUST",
        source: "ADMIN",
        reason: "QA support adjustment",
        idempotencyKey: `qa:adjust:${orgId}`,
        createdBy: "qa-seed",
        createdAt: date(1),
      },
    ],
  });
}

async function putAsset(ownerId, assetId, bytes, ext, source = "GENERATED") {
  const stored = await writeLocalObject(ownerId, bytes, ext);
  return prisma.asset.upsert({
    where: { id: assetId },
    create: {
      id: assetId,
      ownerId,
      contentHash: stored.contentHash,
      ext,
      mime: mimeOf(ext),
      sizeBytes: stored.sizeBytes,
      originalFilename: `${assetId}.${ext}`,
      source,
      width: ext === "mp4" ? 256 : 8,
      height: ext === "mp4" ? 160 : 8,
      durationS: ext === "mp4" ? 1 : null,
      createdAt: date(14),
    },
    update: {
      contentHash: stored.contentHash,
      ext,
      mime: mimeOf(ext),
      sizeBytes: stored.sizeBytes,
      width: ext === "mp4" ? 256 : 8,
      height: ext === "mp4" ? 160 : 8,
      durationS: ext === "mp4" ? 1 : null,
      deletedAt: null,
    },
  });
}

async function seedBrandMemory(ownerId, assetIds) {
  const memories = [
    ["about", "QA brand is a Malaysian cafe brand selling weekday lunch sets and festive drink bundles."],
    ["look", "Use bright natural light, clean tabletops, warm greens, and one coral accent only for Otto moments."],
    ["rules", "Never imply unlimited discounts. Always show prices in MYR and keep claims realistic."],
    ["customers", "Primary buyers are office workers within 3km who decide lunch after 10:30am."],
    ["products", "Signature products are gula melaka latte, nasi lemak wrap, and weekend family brunch trays."],
  ];
  for (let i = 0; i < memories.length; i += 1) {
    const [category, content] = memories[i];
    await upsert("memory", { id: id(`${ownerId}_memory_${i + 1}`) }, {
      id: id(`${ownerId}_memory_${i + 1}`),
      ownerId,
      category,
      content,
      source: i % 2 ? "user" : "otto",
      pinned: i < 3,
      createdAt: date(18 - i),
      updatedAt: date(3 - Math.min(i, 2)),
    }, {
      category,
      content,
      source: i % 2 ? "user" : "otto",
      pinned: i < 3,
      deletedAt: null,
    });
  }

  await upsert("brandKit", { id: id(`${ownerId}_brandkit`) }, {
    id: id(`${ownerId}_brandkit`),
    ownerId,
    name: ownerId === FOUNDER ? "Fikirtive demo brand" : "Kaia Cafe",
    colorsJson: { primary: "#1F3A2E", secondary: "#F8DDA8", accent: "#EC5828" },
    fonts: ["Geist", "Hanken Grotesk"],
    tone: "warm, direct, helpful",
    styleGuide: "Show real products clearly. Keep layouts quiet and premium.",
    logoAssetId: assetIds[0] ?? null,
  });

  const rules = [
    ["always", "Show the actual offer, not abstract lifestyle filler."],
    ["never", "Never promise unlimited AI generation or guaranteed ad results."],
    ["tone", "Use calm, useful copy with one clear next action."],
    ["color", "Use green as the main brand color and coral only as Otto accent."],
  ];
  for (let i = 0; i < rules.length; i += 1) {
    const [kind, text] = rules[i];
    await upsert("brandRule", { id: id(`${ownerId}_rule_${i + 1}`) }, {
      id: id(`${ownerId}_rule_${i + 1}`),
      ownerId,
      kind,
      text,
      active: true,
      createdAt: date(12 - i),
    }, { kind, text, active: true });
  }

  const products = [
    ["Gula melaka latte", "Creamy local coffee drink with palm sugar.", "RM 12", "Drinks", assetIds[1]],
    ["Nasi lemak wrap", "Office-friendly lunch wrap with sambal crunch.", "RM 16", "Lunch", assetIds[2]],
    ["Weekend brunch tray", "Family tray for four with pastries and kopi.", "RM 68", "Bundles", assetIds[3]],
    ["Iced pandan matcha", "Green tea drink for afternoon promos.", "RM 14", "Drinks", assetIds[4]],
    ["Raya cookie tin", "Festive limited tin for gifting campaigns.", "RM 39", "Seasonal", assetIds[5]],
  ];
  for (let i = 0; i < products.length; i += 1) {
    const [name, description, price, category, imageAssetId] = products[i];
    await upsert("brandRecord", { id: id(`${ownerId}_product_${i + 1}`) }, {
      id: id(`${ownerId}_product_${i + 1}`),
      ownerId,
      kind: "product",
      nameKey: name.toLowerCase(),
      data: { name, description, price, category, sellingAngle: "Fast lunch decision, premium local taste", imageAssetId },
      status: "active",
      source: "user",
      pinned: i < 2,
      createdAt: date(15 - i),
      updatedAt: date(2),
    }, {
      data: { name, description, price, category, sellingAngle: "Fast lunch decision, premium local taste", imageAssetId },
      status: "active",
      source: "user",
      pinned: i < 2,
      deletedAt: null,
    });
  }

  const segments = [
    ["Office lunch regulars", "Workers near KL Sentral who need fast weekday meals.", "Short lunch windows", "A reliable, tasty order under RM20"],
    ["Weekend families", "Parents looking for easy brunch after errands.", "Decision fatigue", "A tray that feels generous without planning"],
    ["Gift buyers", "Customers buying seasonal tins for colleagues.", "Needs a safe gift", "Festive, polished packaging"],
  ];
  for (let i = 0; i < segments.length; i += 1) {
    const [name, who, pains, wants] = segments[i];
    await upsert("brandRecord", { id: id(`${ownerId}_segment_${i + 1}`) }, {
      id: id(`${ownerId}_segment_${i + 1}`),
      ownerId,
      kind: "segment",
      nameKey: name.toLowerCase(),
      data: { name, who, pains, wants, channels: "Instagram, WhatsApp, walk-in posters" },
      status: "active",
      source: "otto",
      pinned: i === 0,
      createdAt: date(10 - i),
      updatedAt: date(1),
    }, {
      data: { name, who, pains, wants, channels: "Instagram, WhatsApp, walk-in posters" },
      status: "active",
      source: "otto",
      pinned: i === 0,
      deletedAt: null,
    });
  }

  const offers = [
    ["Weekday lunch combo", "Wrap + iced tea before 2pm.", "LUNCH12", -2, 20],
    ["Raya pre-order", "Cookie tin early-bird bundle.", "RAYAQA", 5, 28],
    ["Expired QA offer", "Old promo kept for edge-case display.", "OLDQA", -40, -5],
  ];
  for (let i = 0; i < offers.length; i += 1) {
    const [title, details, code, startOffset, endOffset] = offers[i];
    await upsert("brandRecord", { id: id(`${ownerId}_offer_${i + 1}`) }, {
      id: id(`${ownerId}_offer_${i + 1}`),
      ownerId,
      kind: "offer",
      nameKey: title.toLowerCase(),
      data: { title, details, code, appliesTo: "Instagram and WhatsApp" },
      status: "active",
      startsAt: date(-startOffset),
      endsAt: date(-endOffset),
      source: "user",
      pinned: i === 0,
      createdAt: date(8 - i),
      updatedAt: date(1),
    }, {
      data: { title, details, code, appliesTo: "Instagram and WhatsApp" },
      status: "active",
      startsAt: date(-startOffset),
      endsAt: date(-endOffset),
      source: "user",
      pinned: i === 0,
      deletedAt: null,
    });
  }
}

async function seedEntities(ownerId, assets) {
  const specs = [
    ["CHARACTER", "Aisha owner", "friendly owner, coral apron", "Do not over-glamorize"],
    ["CHARACTER", "Lunch regular", "office worker, tote bag", "No generic corporate stock look"],
    ["PRODUCT", "Gula melaka latte", "cold cup, condensation, palm sugar", "No messy spills"],
    ["PRODUCT", "Nasi lemak wrap", "paper wrap, sambal texture", "No fake ingredients"],
    ["PRODUCT", "Raya cookie tin", "green tin, gold label", "No Christmas cues"],
    ["LOCATION", "KL cafe counter", "bright counter, menu board", "No empty sterile room"],
    ["BRANDMARK", "Kaia leaf mark", "simple leaf logo", "No complex badge"],
    ["LOCATION", "Mall kiosk", "compact retail kiosk", "No luxury hotel lobby"],
    ["CHARACTER", "Weekend parent", "casual parent with child just off-frame", "No visible child face"],
    ["PRODUCT", "Weekend brunch tray", "four-person tray, pastries and kopi", "No buffet chaos"],
    ["PRODUCT", "Iced pandan matcha", "green drink, clean cup", "No artificial neon"],
    ["CHARACTER", "Delivery rider", "helmet on table, friendly handoff", "No platform logos"],
  ];
  for (let i = 0; i < specs.length; i += 1) {
    const [type, name, notes, negativeConstraints] = specs[i];
    const entityId = id(`${ownerId}_entity_${i + 1}`);
    const asset = assets[i % assets.length];
    await upsert("entity", { id: entityId }, {
      id: entityId,
      ownerId,
      type,
      name,
      aliases: [name.toLowerCase().replaceAll(" ", "-"), `qa-${i + 1}`],
      notes,
      negativeConstraints,
      promptTokens: [name, "qa-seed"],
      baseAssetId: asset.id,
      createdAt: date(16 - (i % 10)),
    }, {
      type,
      name,
      aliases: [name.toLowerCase().replaceAll(" ", "-"), `qa-${i + 1}`],
      notes,
      negativeConstraints,
      promptTokens: [name, "qa-seed"],
      baseAssetId: asset.id,
      deletedAt: null,
    });
    await upsert("referenceImage", { id: id(`${entityId}_ref_base`) }, {
      id: id(`${entityId}_ref_base`),
      ownerId,
      entityId,
      assetId: asset.id,
      position: 0,
      note: "QA seed base reference",
      viewTag: "front",
      createdAt: date(15 - (i % 7)),
    }, { position: 0, note: "QA seed base reference", deletedAt: null });
    if (type !== "LOCATION") {
      const variantId = id(`${entityId}_variant_1`);
      await upsert("entityVariant", { id: variantId }, {
        id: variantId,
        ownerId,
        entityId,
        name: "Campaign variant",
        handle: "campaign",
        prompt: "Seasonal campaign styling with the same identity.",
        createdAt: date(9 - (i % 5)),
      }, {
        name: "Campaign variant",
        handle: "campaign",
        prompt: "Seasonal campaign styling with the same identity.",
        deletedAt: null,
      });
      await upsert("referenceImage", { id: id(`${entityId}_ref_variant`) }, {
        id: id(`${entityId}_ref_variant`),
        ownerId,
        entityId,
        assetId: assets[(i + 1) % assets.length].id,
        variantId,
        position: 0,
        note: "QA seed variant reference",
        viewTag: "campaign",
        createdAt: date(8 - (i % 4)),
      }, { assetId: assets[(i + 1) % assets.length].id, variantId, note: "QA seed variant reference", deletedAt: null });
    }
  }
}

async function seedProjects(ownerId, imageAssets, videoAsset, projectCount, gensPerProject) {
  const projectNames = [
    "Raya lunch launch",
    "Weekday office combo",
    "Weekend brunch tray",
    "Mall kiosk opening",
    "WhatsApp reorder push",
    "Shopee bundle teaser",
    "TikTok drink test",
    "Meta retargeting draft",
  ];
  const entityIds = (await prisma.entity.findMany({ where: { ownerId, deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } })).map((e) => e.id);
  const made = [];
  for (let p = 1; p <= projectCount; p += 1) {
    const projectId = id(`${ownerId}_project_${String(p).padStart(2, "0")}`);
    made.push(projectId);
    await upsert("project", { id: projectId }, {
      id: projectId,
      ownerId,
      name: projectNames[(p - 1) % projectNames.length],
      coworkBrief: "Create clear SEA SMB marketing assets with honest offers, visible products, and next-step copy.",
      createdAt: date(30 - p),
      updatedAt: date(5 - p),
    }, {
      name: projectNames[(p - 1) % projectNames.length],
      coworkBrief: "Create clear SEA SMB marketing assets with honest offers, visible products, and next-step copy.",
      deletedAt: null,
    });

    const shotIds = [];
    for (let s = 1; s <= 12; s += 1) {
      const shotId = id(`${projectId}_shot_${String(s).padStart(2, "0")}`);
      shotIds.push(shotId);
      await upsert("shot", { id: shotId }, {
        id: shotId,
        projectId,
        ownerId,
        number: s,
        scene: Math.ceil(s / 4),
        title: `QA shot ${s}`,
        description: `Product-led campaign frame ${s}`,
        status: s <= 4 ? "FINAL" : s <= 8 ? "ATTACHED" : "DRAFT",
        promptDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Show ${projectNames[(p - 1) % projectNames.length]} frame ${s}` }] }] },
        transition: s % 4 === 0 ? "out" : null,
        createdAt: date(25 - p, s),
      }, {
        title: `QA shot ${s}`,
        description: `Product-led campaign frame ${s}`,
        status: s <= 4 ? "FINAL" : s <= 8 ? "ATTACHED" : "DRAFT",
        promptDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Show ${projectNames[(p - 1) % projectNames.length]} frame ${s}` }] }] },
        transition: s % 4 === 0 ? "out" : null,
        deletedAt: null,
      });
      const entityId = entityIds[(s + p) % entityIds.length];
      await prisma.shotEntityRef.createMany({
        skipDuplicates: true,
        data: [{ shotId, entityId, ownerId }],
      });
    }

    const firstThreadId = id(`${projectId}_thread_01`);
    for (let g = 1; g <= gensPerProject; g += 1) {
      const isVideo = g % 7 === 0;
      const isAttached = g <= shotIds.length;
      const isAd = g > shotIds.length && g % 3 === 0;
      const asset = isVideo ? videoAsset : imageAssets[(g + p) % imageAssets.length];
      const genId = id(`${projectId}_gen_${String(g).padStart(3, "0")}`);
      await upsert("generation", { id: genId }, {
        id: genId,
        ownerId,
        projectId,
        shotId: isAttached ? shotIds[g - 1] : null,
        assetId: asset.id,
        source: "GENERATED",
        promptText: `${isVideo ? "Video" : "Image"} QA creative ${g} for ${projectNames[(p - 1) % projectNames.length]}`,
        modelRef: isVideo ? "seedance-2-fast" : "seedream",
        params: isVideo ? { durationSeconds: 5, aspectRatio: "9:16" } : { aspectRatio: "1:1" },
        entitySnapshot: { entities: entityIds.slice(0, 2).map((entityId) => ({ id: entityId, name: "QA entity" })) },
        version: isAttached ? 1 : 1,
        threadId: isAd ? firstThreadId : null,
        favorite: g % 10 === 0,
        attachedAt: isAttached ? date(20 - p, g) : null,
        createdAt: date(Math.max(0, 18 - Math.floor(g / 5)), g),
      }, {
        shotId: isAttached ? shotIds[g - 1] : null,
        assetId: asset.id,
        promptText: `${isVideo ? "Video" : "Image"} QA creative ${g} for ${projectNames[(p - 1) % projectNames.length]}`,
        modelRef: isVideo ? "seedance-2-fast" : "seedream",
        params: isVideo ? { durationSeconds: 5, aspectRatio: "9:16" } : { aspectRatio: "1:1" },
        threadId: isAd ? firstThreadId : null,
        favorite: g % 10 === 0,
        deletedAt: null,
      });
    }

    await seedThreads(ownerId, projectId, p, firstThreadId);
    await seedCanvas(ownerId, projectId, imageAssets, videoAsset, firstThreadId);
  }
  return made;
}

async function seedThreads(ownerId, projectId, projectIndex, firstThreadId) {
  for (let t = 1; t <= 5; t += 1) {
    const threadId = t === 1 ? firstThreadId : id(`${projectId}_thread_${String(t).padStart(2, "0")}`);
    const updatedAt = date(Math.max(0, 7 - t), projectIndex * t);
    await upsert("chatThread", { id: threadId }, {
      id: threadId,
      ownerId,
      projectId,
      title: t === 1 ? "Launch ad set with approved creative" : `QA conversation ${t}`,
      rollingSummary: "QA seeded thread covering text, cards, results, approval, and errors.",
      createdAt: date(12 - t),
      updatedAt,
    }, {
      title: t === 1 ? "Launch ad set with approved creative" : `QA conversation ${t}`,
      rollingSummary: "QA seeded thread covering text, cards, results, approval, and errors.",
      updatedAt,
      deletedAt: null,
    });
  }

  const resultGen = await prisma.generation.findFirst({ where: { ownerId, projectId, threadId: firstThreadId, deletedAt: null }, orderBy: { createdAt: "desc" } });
  const jobId = id(`${projectId}_job_done`);
  await upsert("genJob", { id: jobId }, {
    id: jobId,
    ownerId,
    projectId,
    prompt: "Make four square lunch ad images with clear product focus.",
    entityIds: [],
    idempotencyKey: `qa:${projectId}:done`,
    threadId: firstThreadId,
    kind: "IMAGE",
    model: "seedream",
    count: 4,
    status: "DONE",
    progress: 100,
    generationIds: resultGen ? [resultGen.id] : [],
    spent: true,
    spentUsd: 0.4,
    createdAt: date(4),
    updatedAt: date(3),
    finishedAt: date(3),
  }, {
    generationIds: resultGen ? [resultGen.id] : [],
    status: "DONE",
    progress: 100,
    spent: true,
    spentUsd: 0.4,
  });
  await upsert("genJob", { id: id(`${projectId}_job_running`) }, {
    id: id(`${projectId}_job_running`),
    ownerId,
    projectId,
    prompt: "Animate the best lunch frame for reels.",
    idempotencyKey: `qa:${projectId}:running`,
    threadId: firstThreadId,
    kind: "VIDEO",
    model: "seedance-2-fast",
    count: 1,
    status: "GENERATING",
    progress: 42,
    videoOptions: { durationSeconds: 5, aspectRatio: "9:16", resolution: "720p" },
    createdAt: date(0, 40),
    updatedAt: date(0, 20),
  }, { status: "GENERATING", progress: 42, updatedAt: date(0, 20) });
  await upsert("genJob", { id: id(`${projectId}_job_failed`) }, {
    id: id(`${projectId}_job_failed`),
    ownerId,
    projectId,
    prompt: "Failed QA edge case card",
    idempotencyKey: `qa:${projectId}:failed`,
    threadId: firstThreadId,
    kind: "IMAGE",
    model: "seedream",
    count: 1,
    status: "FAILED",
    progress: 0,
    error: "QA seeded provider error, sanitized",
    createdAt: date(1, 10),
    updatedAt: date(1, 5),
  }, { status: "FAILED", error: "QA seeded provider error, sanitized", updatedAt: date(1, 5) });

  const messages = [
    {
      id: id(`${firstThreadId}_msg_01`),
      seq: 1,
      role: "USER",
      kind: "TEXT",
      text: "Create an ad batch for our weekday lunch combo.",
    },
    {
      id: id(`${firstThreadId}_msg_02`),
      seq: 2,
      role: "AGENT",
      kind: "TEXT",
      text: "I will keep the food visible, use MYR pricing, and prepare square + story variants.",
    },
    {
      id: id(`${firstThreadId}_msg_03`),
      seq: 3,
      role: "AGENT",
      kind: "GEN_CARD",
      text: "",
      payload: {
        kind: "image",
        structuredPrompt: "A bright Malaysian cafe lunch combo on a clean tabletop, visible price card, warm natural daylight.",
        desiredAspect: "1:1",
        entityIds: [],
        variantSel: {},
        estimatedPriceUsd: 0.4,
        packId: id(`${projectId}_pack_1`),
      },
      genJobId: jobId,
    },
    {
      id: id(`${firstThreadId}_msg_04`),
      seq: 4,
      role: "AGENT",
      kind: "GEN_RESULT",
      text: "",
      payload: { kind: "image", model: "seedream", costCredits: 4 },
      genJobId: jobId,
    },
    {
      id: id(`${firstThreadId}_msg_05`),
      seq: 5,
      role: "AGENT",
      kind: "ACTION_CARD",
      text: "",
      payload: {
        planTitle: "Pause low-performing QA ad set",
        steps: [{ label: "Pause ad set", status: "ready", spend: false }],
        spend: { cost: 0, currency: "credits" },
        autoEligible: false,
        approval: { expiresAt: date(-2).toISOString(), consumedAt: null, boundActor: ownerId, paramHash: "qa" },
      },
    },
    {
      id: id(`${firstThreadId}_msg_06`),
      seq: 6,
      role: "AGENT",
      kind: "RESEARCH_CARD",
      text: "",
      payload: {
        topic: "Competitor lunch promos near KL Sentral",
        tier: "quick",
        status: "planned",
        estimatedCredits: 5,
        questions: ["What offers are common?", "Which angles avoid discount fatigue?"],
      },
    },
  ];
  for (const m of messages) {
    await upsert("chatMessage", { id: m.id }, {
      id: m.id,
      threadId: firstThreadId,
      ownerId,
      role: m.role,
      kind: m.kind,
      seq: m.seq,
      text: m.text,
      payload: m.payload ?? null,
      genJobId: m.genJobId ?? null,
      createdAt: date(3, 40 - m.seq),
    }, {
      role: m.role,
      kind: m.kind,
      seq: m.seq,
      text: m.text,
      payload: m.payload ?? null,
      genJobId: m.genJobId ?? null,
      deletedAt: null,
    });
  }
}

async function seedCanvas(ownerId, projectId, imageAssets, videoAsset, threadId) {
  const gen = await prisma.generation.findFirst({ where: { ownerId, projectId, assetId: imageAssets[0].id }, select: { id: true } });
  const videoGen = await prisma.generation.findFirst({ where: { ownerId, projectId, assetId: videoAsset.id }, select: { id: true } });
  const nodes = [
    { id: id(`${projectId}_node_text`), type: "text", x: 80, y: 80, w: 260, h: 120, text: "QA launch board: lunch combo, Raya tin, office buyer segment.", threadId: null },
    { id: id(`${projectId}_node_image`), type: "image", x: 380, y: 80, w: 320, h: 320, generationId: gen?.id ?? null, status: "done", threadId },
    { id: id(`${projectId}_node_video`), type: "video", x: 740, y: 80, w: 260, h: 360, generationId: videoGen?.id ?? null, status: "done", threadId },
    { id: id(`${projectId}_node_pending`), type: "image", x: 1040, y: 120, w: 240, h: 240, prompt: "In-flight QA node", genJobId: id(`${projectId}_job_running`), status: "pending", threadId },
  ];
  for (const n of nodes) {
    await upsert("canvasNode", { id: n.id }, {
      id: n.id,
      ownerId,
      projectId,
      type: n.type,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.text ?? null,
      prompt: n.prompt ?? null,
      generationId: n.generationId ?? null,
      genJobId: n.genJobId ?? null,
      status: n.status ?? "done",
      threadId: n.threadId ?? null,
      createdAt: date(3),
    }, {
      type: n.type,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.text ?? null,
      prompt: n.prompt ?? null,
      generationId: n.generationId ?? null,
      genJobId: n.genJobId ?? null,
      status: n.status ?? "done",
      threadId: n.threadId ?? null,
    });
  }
}

async function seedAdminSurface() {
  const qaMetaTokenEnc = encryptQaToken("qa_meta_fixture_token");
  const directives = [
    ["seedream", "t2i", "Use natural prose, visible product, clear scene, and realistic local offer details."],
    ["seedream", "i2i", "Describe the edit clearly and preserve the reference identity."],
    ["seedance", "t2v", "Lead with motion and camera, one primary action, one camera move."],
    ["veo", "t2v", "Director-style prompt with action, camera, lighting, and audio cue."],
  ];
  for (const [family, mode, directive] of directives) {
    const row = await prisma.modelDirective.upsert({
      where: { ownerId_family_mode: { ownerId: FOUNDER, family, mode } },
      create: {
        id: id(`directive_${family}_${mode}`),
        ownerId: FOUNDER,
        family,
        mode,
        directive,
        rules: { qaSeed: true },
        notes: "QA seed directive",
        confidence: "medium",
        enabled: true,
        source: "qa-seed",
      },
      update: { directive, rules: { qaSeed: true }, notes: "QA seed directive", confidence: "medium", enabled: true, source: "qa-seed" },
    });
    await prisma.modelDirectiveRevision.createMany({
      skipDuplicates: true,
      data: [{
        id: id(`directive_rev_${family}_${mode}`),
        directiveId: row.id,
        ownerId: FOUNDER,
        directive,
        rules: { qaSeed: true },
        confidence: "medium",
        enabled: true,
        source: "qa-seed",
        editedBy: "qa-seed",
        createdAt: date(2),
      }],
    });
  }

  await upsert("runtimeConfig", { key: "vision" }, {
    key: "vision",
    valueJson: { enabled: true, maxImages: 4, maxBytes: 4000000 },
    updatedBy: "qa-seed",
  }, { valueJson: { enabled: true, maxImages: 4, maxBytes: 4000000 }, updatedBy: "qa-seed" });
  await upsert("runtimeConfig", { key: "cowork_provider" }, {
    key: "cowork_provider",
    valueJson: { provider: "mock" },
    updatedBy: "qa-seed",
  }, { valueJson: { provider: "mock" }, updatedBy: "qa-seed" });
  await prisma.modelRegistryOverlay.upsert({
    where: { ownerId_modelId: { ownerId: FOUNDER, modelId: "veo3.1-lite" } },
    create: { id: id("model_overlay_veo"), ownerId: FOUNDER, modelId: "veo3.1-lite", enabled: false, notes: "QA disabled model row" },
    update: { enabled: false, notes: "QA disabled model row" },
  });
  await prisma.metaConnection.upsert({
    where: { ownerId: FOUNDER },
    create: {
      id: id("meta_founder"),
      ownerId: FOUNDER,
      metaUserId: "qa_meta_user",
      accessTokenEnc: qaMetaTokenEnc,
      tokenExpiresAt: date(-30),
      scope: "ads_read,ads_management,pages_show_list",
      status: "active",
      adsAutonomy: "ASK",
      adsWritesPaused: true,
      canWrite: true,
      canManagePages: true,
      defaultPageId: "qa_page_1",
    },
    update: {
      accessTokenEnc: qaMetaTokenEnc,
      tokenExpiresAt: date(-30),
      scope: "ads_read,ads_management,pages_show_list",
      status: "active",
      adsAutonomy: "ASK",
      adsWritesPaused: true,
      canWrite: true,
      canManagePages: true,
      defaultPageId: "qa_page_1",
    },
  });
}

async function seedAuditEvents() {
  const events = [
    ["auth.signin", { email: "founder.qa@example.test" }],
    ["directive.seed", { inserted: 4, via: "qa-seed" }],
    ["model.toggle", { modelId: "veo3.1-lite", enabled: false }],
    ["tenant.invite", { email: "merchant.qa@example.test" }],
    ["generation.outcome", { generationId: id(`${FOUNDER}_project_01_gen_001`), result: "approved", posted: false }],
    ["credits.grant", { orgId: MERCHANT, displayedAmount: 250 }],
  ];
  await prisma.actionEvent.createMany({
    skipDuplicates: true,
    data: events.map(([type, payload], i) => ({
      id: id(`event_${i + 1}`),
      ownerId: FOUNDER,
      type,
      payload,
      createdAt: date(i),
    })),
  });
}

async function seedOwner(ownerId, projectCount, gensPerProject, displayedBalance, displayedReserved) {
  const imageAssets = [];
  for (let i = 1; i <= 140; i += 1) {
    imageAssets.push(await putAsset(ownerId, id(`${ownerId}_asset_img_${String(i).padStart(3, "0")}`), solidPng(i + ownerId.length * 31), "png"));
  }
  const videoAsset = await putAsset(ownerId, id(`${ownerId}_asset_video_001`), Buffer.from(MOCK_MP4_B64, "base64"), "mp4");
  await seedCredits(ownerId, displayedBalance, displayedReserved);
  await seedBrandMemory(ownerId, imageAssets.map((a) => a.id));
  await seedEntities(ownerId, imageAssets);
  await seedProjects(ownerId, imageAssets, videoAsset, projectCount, gensPerProject);
}

async function main() {
  await mkdir(path.join(ROOT, ".data"), { recursive: true });
  await seedIdentity();
  await seedOwner(FOUNDER, 8, 72, 4700, 18);
  await seedOwner(MERCHANT, 2, 28, 920, 8);
  await seedAdminSurface();
  await seedAuditEvents();

  const [
    orgs,
    projects,
    entities,
    assets,
    generations,
    threads,
    messages,
    nodes,
    ledgers,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.project.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.entity.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.asset.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.generation.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.chatThread.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.chatMessage.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.canvasNode.count({ where: { id: { startsWith: "qa_" } } }),
    prisma.creditLedger.count({ where: { id: { startsWith: "qa_" } } }),
  ]);
  console.log(JSON.stringify({
    ok: true,
    database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
    storageRoot: STORAGE_ROOT,
    loginEmails: USERS.map((u) => u.email),
    counts: { orgs, projects, entities, assets, generations, threads, messages, nodes, ledgers },
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
