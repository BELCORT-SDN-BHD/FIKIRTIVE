/**
 * #803 — the exit from "merchant entered, not verified".
 *
 * A merchant-typed phone number is stored at the lower credibility grade and is deliberately not
 * audience material. That grade needs a way OUT, or the merchant's address book becomes a room
 * with no door: numbers that are perfectly real can never become reachable no matter what the
 * customer does. The door is this writer — the one place a stored identity is upgraded when a
 * connected channel confirms it.
 *
 * Traceable by construction: the upgrade writes WHEN it happened and WHAT confirmed it onto the
 * row itself (verifiedAt / verifiedSourceKind), and the database CHECK refuses a "verified" row
 * that cannot show both. It also refuses to invent an identity: confirming a number nobody stored
 * is not this function's business, it returns `matched: false` and writes nothing.
 *
 * Not yet called in production — no channel is connected (#792). It exists now because the grade
 * it releases ships now, it is exercised by tests, and the alternative (ship the lower grade with
 * no upgrade path and add one later) is exactly how a one-way container gets built.
 */
import {
  CHANNEL_VERIFIED_IDENTITY,
  MERCHANT_UNVERIFIED_IDENTITY,
} from "@fikirtive/core";
import { Prisma } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
export type ContactIdentityDb = Tx | { contactIdentity: Tx["contactIdentity"] };

const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type ChannelVerificationInput = {
  /** Always from the authenticated server principal / connector tenant. Never client-supplied. */
  ownerId: string;
  channel: string;
  externalId: string;
  /** What confirmed it, e.g. `inbound_message`. Recorded on the row as the upgrade's evidence. */
  sourceKind: string;
  verifiedAt?: Date;
};

export type ChannelVerificationResult = {
  /** A live identity for this tenant/channel/number existed. */
  matched: boolean;
  /** This call is what moved it from merchant-entered to channel-verified. */
  upgraded: boolean;
  contactIdentityId: string | null;
};

export class ContactIdentityError extends Error {
  readonly code = "INVALID_ARGUMENT";

  constructor(message: string) {
    super(message);
    this.name = "ContactIdentityError";
  }
}

/**
 * Idempotent. Re-confirming an already verified identity keeps the ORIGINAL evidence: the fact
 * being recorded is when this number was first confirmed, and a later message is not new news.
 */
export async function markContactIdentityChannelVerified(
  client: ContactIdentityDb,
  input: ChannelVerificationInput,
): Promise<ChannelVerificationResult> {
  if (!input.ownerId) throw new ContactIdentityError("ownerId is required.");
  if (!TOKEN.test(input.channel)) throw new ContactIdentityError("channel is outside the closed taxonomy.");
  if (!TOKEN.test(input.sourceKind)) throw new ContactIdentityError("sourceKind is outside the closed taxonomy.");
  const externalId = input.externalId?.trim() ?? "";
  if (!externalId || externalId.length > 256) throw new ContactIdentityError("externalId is required.");

  // The live partial unique index (ownerId, channel, externalId) makes this at most one row.
  const identity = await client.contactIdentity.findFirst({
    where: {
      ownerId: input.ownerId,
      channel: input.channel,
      externalId,
      deletedAt: null,
    },
    select: { id: true, verificationStatus: true },
  });
  if (!identity) return { matched: false, upgraded: false, contactIdentityId: null };
  if (identity.verificationStatus === CHANNEL_VERIFIED_IDENTITY) {
    return { matched: true, upgraded: false, contactIdentityId: identity.id };
  }

  // The ownerId stays in the WHERE of the write itself, not only in the read above.
  const { count } = await client.contactIdentity.updateMany({
    where: {
      id: identity.id,
      ownerId: input.ownerId,
      deletedAt: null,
      verificationStatus: MERCHANT_UNVERIFIED_IDENTITY,
    },
    data: {
      verificationStatus: CHANNEL_VERIFIED_IDENTITY,
      verifiedAt: input.verifiedAt ?? new Date(),
      verifiedSourceKind: input.sourceKind,
    },
  });
  return { matched: true, upgraded: count === 1, contactIdentityId: identity.id };
}
