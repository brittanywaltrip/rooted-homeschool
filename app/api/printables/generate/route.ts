import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { type, style, data, size } = await req.json();
    if (!type || !style || !data) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { generateCertificateHTML } = await import("@/lib/certificate-templates");
    const html = generateCertificateHTML(type, style, data);

    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

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
    console.error("[Printables API]", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 }
    );
  }
}
