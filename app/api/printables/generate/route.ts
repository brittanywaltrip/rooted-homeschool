import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;

  try {
    const { type, style, data, size } = await req.json();
    if (!type || !style || !data) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { generateCertificateHTML } = await import("@/lib/certificate-templates");
    const html = generateCertificateHTML(type, style, data);

    const chromium = (await import("@sparticuz/chromium-min")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    const executablePath = await chromium.executablePath(
      "https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar"
    );

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15000 });

    const isIdCard = size === "id_card";
    const pdf = await page.pdf({
      width: isIdCard ? "3.5in" : "8.5in",
      height: isIdCard ? "2in" : "11in",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    await browser.close();

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${type}-certificate.pdf"`,
      },
    });
  } catch (err) {
    console.error("[Printables API] PDF generation failed:", err);
    try { if (browser) await browser.close(); } catch { /* ignore cleanup error */ }
    const message = err instanceof Error ? err.message : "PDF generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
