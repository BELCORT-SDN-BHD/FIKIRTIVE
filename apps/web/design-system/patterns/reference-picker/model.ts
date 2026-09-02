export type ReferencePickerState = "recent" | "search" | "category" | "selected" | "empty" | "unavailable"

export type ReferenceType =
  | "product"
  | "character"
  | "official-avatar"
  | "location"
  | "clothes"
  | "generation"
  | "upload"

export type ReferenceItem = {
  id: string
  name: string
  type: ReferenceType
  meta: string
  image?: string
  unavailableReason?: string
}

export const REFERENCE_PICKER_STATES: readonly { value: ReferencePickerState; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "search", label: "Search" },
  { value: "category", label: "Category" },
  { value: "selected", label: "Selected" },
  { value: "empty", label: "No matches" },
  { value: "unavailable", label: "Unavailable" },
]

export function isReferencePickerState(value: string | undefined): value is ReferencePickerState {
  return REFERENCE_PICKER_STATES.some((state) => state.value === value)
}
