/**
 * Plain DTOs crossing the server→client boundary. Prisma rows carry BigInt
 * (Asset.sizeBytes) which RSC serialization rejects, so page.tsx maps rows to
 * these shapes; file locations become browser URLs here (DB stores no paths).
 */

export type EntityTypeDTO = "CHARACTER" | "LOCATION" | "PRODUCT" | "BRAND";
export type ShotStatusDTO = "DRAFT" | "EXPORTED" | "ATTACHED" | "FINAL";

export interface RefImageDTO {
  id: string;
  assetId: string; // the underlying Asset id — lets the UI match the base + call setBaseAsset
  url: string;
  kind: "image" | "video" | "other";
}

export interface VariantDTO {
  id: string;
  name: string;
  handle: string; // @name:handle
  prompt: string; // the change description used to (re)generate it
  refs: RefImageDTO[]; // this variant's generated images (variantId-tagged), position asc
}

export interface EntityDTO {
  id: string;
  type: EntityTypeDTO;
  name: string;
  aliases: string[]; // alternate names the @mention search also matches
  notes: string;
  negativeConstraints: string;
  refs: RefImageDTO[]; // base-level refs only (variantId null)
  baseAssetId: string | null; // the locked base — one of refs' assetId, or null
  variants: VariantDTO[];
  usageCount: number; // # of shots whose prompt mentions this entity
}

export interface GenerationDTO {
  id: string;
  version: number;
  promptText: string;
  createdAt: string; // ISO
  url: string;
  kind: "image" | "video" | "other";
  filename: string;
}

export interface ShotDTO {
  id: string;
  number: number;
  title: string;
  status: ShotStatusDTO;
  promptDoc: unknown | null; // Tiptap JSON, chips store entity IDs
  promptText: string;
  entityIds: string[];
  generations: GenerationDTO[]; // attached, version desc
}

export interface ProjectDTO {
  id: string;
  name: string;
}

export interface ChatMessageDTO {
  id: string;
  role: "USER" | "AGENT";
  kind: "TEXT" | "PLAN" | "GEN_CARD" | "GEN_RESULT" | "DENIAL" | "TURN_ERROR";
  seq: number;
  text: string;
  payload: unknown | null;
  genJobId: string | null;
  createdAt: string;
}

export interface ChatThreadDTO {
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
  messages: ChatMessageDTO[];
}
