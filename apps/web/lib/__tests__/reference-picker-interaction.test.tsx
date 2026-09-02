// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReferencePickerReference } from "@/design-system/patterns/reference-picker/ReferencePickerReference"

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = (callback) => {
  callback(0)
  return 0
}

let root: Root | null = null
let container: HTMLDivElement | null = null
const originalScrollIntoView = Element.prototype.scrollIntoView

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  Element.prototype.scrollIntoView = originalScrollIntoView
})

async function render(state: "recent" | "empty" | "unavailable" = "recent") {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<ReferencePickerReference initialState={state} />))
  return container
}

async function press(target: EventTarget, key: string, options: { shiftKey?: boolean; isComposing?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options })
  await act(async () => target.dispatchEvent(event))
  return event
}

async function updateComposer(composer: HTMLTextAreaElement, value: string, caret = value.length) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    valueSetter?.call(composer, value)
    composer.setSelectionRange(caret, caret)
    composer.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function click(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
  })
}

describe("Reference picker interaction", () => {
  it("selects an initially visible reference when the untouched textarea caret is at zero", async () => {
    const dom = await render()
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    composer.setSelectionRange(0, 0)
    expect(document.activeElement).not.toBe(composer)

    await click(Array.from(dom.querySelectorAll<HTMLButtonElement>('button[role="option"]'))
      .find((button) => button.textContent?.includes("Alya"))!)

    expect(dom.querySelector('button[aria-label="Remove Alya"]')).not.toBeNull()
    expect(composer.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(composer)
    expect(composer.selectionStart).toBe(0)
  })

  it("keeps plain Enter for a newline, sends with Shift+Enter, and ignores IME composition", async () => {
    const dom = await render("empty")
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    composer.focus()

    const enter = await press(composer, "Enter")
    expect(enter.defaultPrevented).toBe(false)
    expect(dom.textContent).not.toContain("References remain visible in conversation")

    const composingEnter = await press(composer, "Enter", { shiftKey: true, isComposing: true })
    expect(composingEnter.defaultPrevented).toBe(false)
    expect(dom.textContent).not.toContain("References remain visible in conversation")

    const send = await press(composer, "Enter", { shiftKey: true })
    expect(send.defaultPrevented).toBe(true)
    expect(dom.textContent).toContain("References remain visible in conversation")
  })

  it("navigates from Recent into categories and returns focus to the composer", async () => {
    const dom = await render()
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    composer.focus()
    composer.setSelectionRange(composer.value.length, composer.value.length)
    await act(async () => composer.dispatchEvent(new Event("select", { bubbles: true })))

    for (let index = 0; index < 5; index += 1) {
      await press(composer, "ArrowDown")
      // Repeated native selection notifications must not reset the active option.
      await act(async () => composer.dispatchEvent(new Event("select", { bubbles: true })))
    }
    await press(composer, "Enter")

    expect(dom.querySelector('button[aria-current="page"]')?.textContent).toBe("Category")
    expect(dom.querySelector('[role="listbox"]')?.textContent).toContain("Jasmine perfume")
    expect(document.activeElement).toBe(composer)
  })

  it("returns pointer category selection and Escape focus to the composer, while Tab selects an available entry", async () => {
    const dom = await render()
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    composer.focus()
    composer.setSelectionRange(composer.value.length, composer.value.length)
    await act(async () => composer.dispatchEvent(new Event("select", { bubbles: true })))

    const products = Array.from(dom.querySelectorAll<HTMLButtonElement>('button[role="option"]'))
      .find((button) => button.textContent?.includes("Products"))!
    await click(products)
    expect(dom.querySelector('button[aria-current="page"]')?.textContent).toBe("Category")
    expect(dom.querySelector('[role="listbox"]')?.textContent).toContain("Jasmine perfume")
    expect(document.activeElement).toBe(composer)

    await press(composer, "Escape")
    expect(composer.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(composer)

    await updateComposer(composer, "", 0)
    await updateComposer(composer, "@")
    expect(composer.getAttribute("aria-expanded")).toBe("true")
    await updateComposer(composer, "@al")
    const shiftTab = await press(composer, "Tab", { shiftKey: true })
    expect(shiftTab.defaultPrevented).toBe(false)
    expect(dom.querySelector('button[aria-label="Remove Alya"]')).toBeNull()
    const tab = await press(composer, "Tab")
    expect(tab.defaultPrevented).toBe(true)
    expect(dom.querySelector('button[aria-label="Remove Alya"]')).not.toBeNull()
    expect(document.activeElement).toBe(composer)
  })

  it("reveals the active row immediately when arrow navigation changes it", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const dom = await render()
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    await updateComposer(composer, "", 0)
    await updateComposer(composer, "@")
    scrollIntoView.mockClear()
    expect(dom.querySelector<HTMLElement>('[role="option"][id$="-option-1"]')?.scrollIntoView).toBe(scrollIntoView)

    await press(composer, "ArrowDown")

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "nearest" })
  })

  it("keeps the composer draft and sent snapshot when returning from a category", async () => {
    const dom = await render()
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!

    await updateComposer(composer, "@al")
    await press(composer, "Enter")
    await press(composer, "Enter", { shiftKey: true })
    await updateComposer(composer, "@")
    const products = Array.from(dom.querySelectorAll<HTMLButtonElement>('button[role="option"]'))
      .find((button) => button.textContent?.includes("Products"))!
    await click(products)
    await click(Array.from(dom.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("All types"))!)

    expect(dom.querySelector('button[aria-current="page"]')?.textContent).toBe("Recent")
    expect(dom.querySelector('button[aria-label="Remove Alya"]')).not.toBeNull()
    expect(dom.textContent).toContain("References remain visible in conversation")
    expect(composer.value).toBe("@")
  })

  it("replaces only the mention next to the caret and does not open for email", async () => {
    const dom = await render()
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!

    await updateComposer(composer, "Before @al after", 10)
    await press(composer, "Enter")

    expect(composer.value).toBe("Before  after")
    expect(composer.selectionStart).toBe(7)
    expect(dom.querySelector('button[aria-label="Remove Alya"]')).not.toBeNull()

    await updateComposer(composer, "email@test.com")
    expect(composer.getAttribute("aria-expanded")).toBe("false")
  })

  it("does not select unavailable entries or mutate a sent reference snapshot", async () => {
    const unavailableDom = await render("unavailable")
    const unavailableComposer = unavailableDom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    unavailableComposer.focus()
    unavailableComposer.setSelectionRange(unavailableComposer.value.length, unavailableComposer.value.length)
    await act(async () => unavailableComposer.dispatchEvent(new Event("select", { bubbles: true })))

    const unavailableEnter = await press(unavailableComposer, "Enter")
    expect(unavailableEnter.defaultPrevented).toBe(false)
    expect(unavailableDom.textContent).not.toContain("References remain visible in conversation")
    expect(unavailableDom.querySelector('[aria-label^="Remove "]')).toBeNull()

    await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null

    const selectedDom = await render("recent")
    const selectedComposer = selectedDom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Otto"]')!
    await updateComposer(selectedComposer, "@al")
    await press(selectedComposer, "Enter")
    await updateComposer(selectedComposer, "@al")
    await press(selectedComposer, "Enter")
    expect(selectedDom.querySelectorAll('button[aria-label="Remove Alya"]')).toHaveLength(1)
    await press(selectedComposer, "Enter", { shiftKey: true })
    await click(selectedDom.querySelector('button[aria-label="Remove Alya"]')!)

    expect(selectedDom.querySelector('button[aria-label="Remove Alya"]')).toBeNull()
    expect(selectedDom.textContent).toContain("@Alya")
  })
})
