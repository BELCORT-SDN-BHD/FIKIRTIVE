"use server";
/**
 * "use server" wrapper for otto-actions so client components (Cowork.tsx,
 * GenerateCard.tsx) can call ottoTurn / ottoApprove as Next.js Server Actions.
 * otto-actions.ts uses `import "server-only"` which prevents direct client import;
 * re-exports are not allowed in "use server" files, so we delegate via async wrappers.
 */
import {
  ottoTurn as _ottoTurn,
  ottoApprove as _ottoApprove,
  createEmptyCoworkThread as _createEmptyCoworkThread,
} from "./otto-actions";

export async function ottoTurn(raw: unknown) {
  return _ottoTurn(raw);
}

export async function ottoApprove(raw: unknown) {
  return _ottoApprove(raw);
}

export async function createEmptyCoworkThread(raw: unknown) {
  return _createEmptyCoworkThread(raw);
}
