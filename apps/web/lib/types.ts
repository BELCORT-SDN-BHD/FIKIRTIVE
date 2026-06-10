/**
 * Plain DTOs crossing the server→client boundary. Prisma rows carry BigInt
 * (Asset.sizeBytes) which RSC serialization rejects, so page.tsx maps rows to
 * these shapes; file locations become browser URLs here (DB stores no paths).
 */

export type EntityTypeDTO = "CHARACTER" | "LOCATION" | "PRODUCT" | "BRAND";
export type ShotStatusDTO = "DRAFT" | "EXPORTED" | "ATTACHED" | "FINAL";

export interface RefImageDTO {
  id: string;
  url: string;
  kind: "image" | "video" | "other";
}

export interface EntityDTO {
  id: string;
  type: EntityTypeDTO;
  name: string;
  notes: string;
  negativeConstraints: string;
  refs: RefImageDTO[];
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
