import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl } from "@/lib/url-safety";

describe("assertPublicHttpUrl", () => {
  describe("ACCEPT: valid public URLs", () => {
    it("accepts https://example.com", () => {
      const result = assertPublicHttpUrl("https://example.com");
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe("example.com");
    });

    it("accepts http://example.com/path?q=1", () => {
      const result = assertPublicHttpUrl("http://example.com/path?q=1");
      expect(result).toBeInstanceOf(URL);
    });

    it("accepts https://192.0.2.1 (TEST-NET-1, public IP)", () => {
      const result = assertPublicHttpUrl("https://192.0.2.1");
      expect(result).toBeInstanceOf(URL);
    });
  });

  describe("REJECT: loopback / localhost", () => {
    it("rejects http://localhost", () => {
      expect(() => assertPublicHttpUrl("http://localhost")).toThrow();
    });

    it("rejects http://127.0.0.1", () => {
      expect(() => assertPublicHttpUrl("http://127.0.0.1")).toThrow();
    });

    it("rejects http://127.0.0.5", () => {
      expect(() => assertPublicHttpUrl("http://127.0.0.5")).toThrow();
    });

    it("rejects http://0.0.0.0", () => {
      expect(() => assertPublicHttpUrl("http://0.0.0.0")).toThrow();
    });
  });

  describe("REJECT: cloud metadata / link-local", () => {
    it("rejects http://169.254.169.254/latest/meta-data", () => {
      expect(() =>
        assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")
      ).toThrow();
    });

    it("rejects http://169.254.0.1", () => {
      expect(() => assertPublicHttpUrl("http://169.254.0.1")).toThrow();
    });
  });

  describe("REJECT: private IPv4 ranges", () => {
    it("rejects http://10.0.0.5 (10/8)", () => {
      expect(() => assertPublicHttpUrl("http://10.0.0.5")).toThrow();
    });

    it("rejects http://10.255.255.255 (10/8)", () => {
      expect(() => assertPublicHttpUrl("http://10.255.255.255")).toThrow();
    });

    it("rejects http://172.16.0.1 (172.16/12)", () => {
      expect(() => assertPublicHttpUrl("http://172.16.0.1")).toThrow();
    });

    it("rejects http://172.31.255.255 (172.16/12)", () => {
      expect(() => assertPublicHttpUrl("http://172.31.255.255")).toThrow();
    });

    it("rejects http://192.168.1.1 (192.168/16)", () => {
      expect(() => assertPublicHttpUrl("http://192.168.1.1")).toThrow();
    });
  });

  describe("REJECT: disallowed protocols", () => {
    it("rejects file:///etc/passwd", () => {
      expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow();
    });

    it("rejects ftp://example.com", () => {
      expect(() => assertPublicHttpUrl("ftp://example.com")).toThrow();
    });

    it("rejects data:text/html,<h1>hi</h1>", () => {
      expect(() =>
        assertPublicHttpUrl("data:text/html,<h1>hi</h1>")
      ).toThrow();
    });
  });

  describe("REJECT: IPv6 private/loopback", () => {
    it("rejects https://[::1] (IPv6 loopback)", () => {
      expect(() => assertPublicHttpUrl("https://[::1]")).toThrow();
    });

    it("rejects https://[fc00::1] (IPv6 unique-local)", () => {
      expect(() => assertPublicHttpUrl("https://[fc00::1]")).toThrow();
    });

    it("rejects https://[fe80::1] (IPv6 link-local)", () => {
      expect(() => assertPublicHttpUrl("https://[fe80::1]")).toThrow();
    });
  });

  describe("REJECT: IPv4-mapped IPv6 (SSRF bypass)", () => {
    it("rejects IPv4-mapped IPv6 loopback (dotted form)", () => {
      expect(() => assertPublicHttpUrl("http://[::ffff:127.0.0.1]")).toThrow();
    });
    it("rejects IPv4-mapped IPv6 cloud metadata (dotted form)", () => {
      expect(() => assertPublicHttpUrl("http://[::ffff:169.254.169.254]")).toThrow();
    });
    it("rejects IPv4-mapped IPv6 private (dotted form)", () => {
      expect(() => assertPublicHttpUrl("http://[::ffff:10.0.0.5]")).toThrow();
    });
    it("rejects IPv4-mapped IPv6 loopback (hex form)", () => {
      expect(() => assertPublicHttpUrl("http://[::ffff:7f00:1]")).toThrow();
    });
    it("rejects IPv4-mapped IPv6 cloud metadata (hex form)", () => {
      expect(() => assertPublicHttpUrl("http://[::ffff:a9fe:a9fe]")).toThrow(); // 169.254.169.254
    });
  });

  describe("REJECT: bare hostnames", () => {
    it("rejects http://internal (bare hostname, no dot)", () => {
      expect(() => assertPublicHttpUrl("http://internal")).toThrow();
    });
  });

  describe("REJECT: unparseable input", () => {
    it("rejects not-a-url", () => {
      expect(() => assertPublicHttpUrl("not-a-url")).toThrow();
    });
  });
});
