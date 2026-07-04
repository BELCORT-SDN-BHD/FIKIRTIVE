import { describe, it, expect } from "vitest";
import { extractProductDraft } from "./product-extract.js";

const BASE = "https://shop.example.com/products/latte-blend";

describe("extractProductDraft — Layer 1 deterministic ($0)", () => {
  it("JSON-LD Product: extracts name, price, description, imageUrl", () => {
    const html = `<html><head>
      <title>Latte Blend | Example Shop</title>
      <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Latte Blend",
        description: "Smooth everyday coffee, medium roast.",
        image: "https://cdn.example.com/latte.jpg",
        offers: { "@type": "Offer", price: "49.00", priceCurrency: "MYR" },
      })}
      </script></head><body>...</body></html>`;
    const d = extractProductDraft(html, BASE);
    expect(d.name).toBe("Latte Blend");
    expect(d.description).toBe("Smooth everyday coffee, medium roast.");
    expect(d.imageUrl).toBe("https://cdn.example.com/latte.jpg");
    expect(d.price).toContain("49.00");
    expect(d.price).toContain("MYR");
    expect(d.sourceUrl).toBe(BASE);
    expect(d.filled).toEqual(expect.arrayContaining(["name", "price", "description", "imageUrl"]));
  });

  it("JSON-LD inside @graph array with mixed types: finds the Product", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList", itemListElement: [] },
        { "@type": "Product", name: "Kopi O", offers: { price: 5, priceCurrency: "MYR" } },
      ],
    })}</script>`;
    const d = extractProductDraft(html, BASE);
    expect(d.name).toBe("Kopi O");
    expect(d.price).toContain("5");
  });

  it("JSON-LD image can be an array or an object with a url", () => {
    const arr = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product", name: "X", image: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    })}</script>`;
    expect(extractProductDraft(arr, BASE).imageUrl).toBe("https://cdn.example.com/a.jpg");

    const obj = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product", name: "Y", image: { "@type": "ImageObject", url: "https://cdn.example.com/c.jpg" },
    })}</script>`;
    expect(extractProductDraft(obj, BASE).imageUrl).toBe("https://cdn.example.com/c.jpg");
  });

  it("falls back to Open Graph when there is no JSON-LD", () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Widget">
      <meta property="og:description" content="An OG-described widget.">
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <meta property="product:price:amount" content="19.90">
      <meta property="product:price:currency" content="MYR">
    </head></html>`;
    const d = extractProductDraft(html, BASE);
    expect(d.name).toBe("OG Widget");
    expect(d.description).toBe("An OG-described widget.");
    expect(d.imageUrl).toBe("https://cdn.example.com/og.jpg");
    expect(d.price).toContain("19.90");
    expect(d.price).toContain("MYR");
  });

  it("JSON-LD wins on conflict, but OG fills the gaps it left", () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "JL Name" })}</script>
      <meta property="og:title" content="OG Name">
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <meta property="product:price:amount" content="9.00">`;
    const d = extractProductDraft(html, BASE);
    expect(d.name).toBe("JL Name"); // JSON-LD wins
    expect(d.imageUrl).toBe("https://cdn.example.com/og.jpg"); // OG fills the gap
    expect(d.price).toContain("9.00");
  });

  it("bare page: name from <title>, first <img> as image, price/description stay empty", () => {
    const html = `<html><head><title>  Bare Product  </title></head>
      <body><img src="/img/hero.png"></body></html>`;
    const d = extractProductDraft(html, BASE);
    expect(d.name).toBe("Bare Product");
    expect(d.imageUrl).toBe("https://shop.example.com/img/hero.png"); // resolved against base
    expect(d.price).toBeUndefined();
    expect(d.description).toBeUndefined();
    expect(d.filled).not.toContain("price");
    expect(d.filled).not.toContain("description");
  });

  it("malformed JSON-LD does not throw; falls through to OG/title", () => {
    const html = `<script type="application/ld+json">{ not valid json </script>
      <meta property="og:title" content="Recovered">`;
    const d = extractProductDraft(html, BASE);
    expect(d.name).toBe("Recovered");
  });

  it("resolves a relative JSON-LD image against the base URL", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "R", image: "/rel/pic.jpg" })}</script>`;
    expect(extractProductDraft(html, BASE).imageUrl).toBe("https://shop.example.com/rel/pic.jpg");
  });

  it("empty html returns a draft with only sourceUrl and an empty filled list", () => {
    const d = extractProductDraft("", BASE);
    expect(d.sourceUrl).toBe(BASE);
    expect(d.name).toBeUndefined();
    expect(d.filled).toEqual([]);
  });
});
