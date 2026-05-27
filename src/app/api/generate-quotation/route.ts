import { NextResponse } from "next/server";
import OpenAI from "openai";

// Force Node.js runtime (OpenAI SDK needs Node, not edge)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateBody = {
  clientRequest?: string;
};

const SYSTEM_PROMPT = `You are BizAssist AI, a quotation assistant for small and medium-sized European businesses.

You write clean, professional draft quotations in clear English using euro (€) currency.

ALWAYS structure your reply in this exact format with these section headers:

Client Request Summary:
Detected Requirements:
Estimated Quotation:
Total Estimated Amount:
Delivery Timeline:
Terms:
Email Draft:

Rules:
- Use euro currency with the € symbol.
- If exact pricing is unclear, give a reasonable estimate and flag it.
- Always include this note in Terms: "Final pricing requires human review before sending to the client."
- Never claim the quotation has been sent — it is always a draft for human review.
- Be concise. No marketing language. No emojis.`;

function buildFallbackQuotation(clientRequest: string, reason: string): string {
  const date = new Date().toLocaleDateString("en-GB");
  const id = "QT-" + Date.now().toString().slice(-6);
  return `BizAssist AI Solutions — Draft Quotation (Fallback Mode)
Quotation: ${id}        Date: ${date}        Mode: AI Fallback

Client Request Summary:
${clientRequest.trim()}

Detected Requirements:
- AI service is temporarily unavailable; please use the catalogue-based generator for an accurate breakdown.

Estimated Quotation:
- Please review the client request and select matching items from the catalogue.

Total Estimated Amount:
- To be calculated from the catalogue.

Delivery Timeline:
- 2–4 weeks after order confirmation.

Terms:
- Prices in EUR, excluding VAT.
- Quotation valid for 30 days.
- Payment terms: 50% advance, 50% on delivery.
- Final pricing requires human review before sending to the client.

Email Draft:
Dear Customer,

Thank you for your enquiry. We have received your request and will respond
with a detailed quotation shortly. Please feel free to reply with any
clarifications in the meantime.

Best regards,
BizAssist AI Solutions

— Fallback notice: ${reason} —`;
}

// Try multiple models in order, fall back to the next on access errors.
const MODEL_CHAIN = ["gpt-4o-mini", "gpt-3.5-turbo"] as const;

export async function POST(request: Request) {
  let clientRequest = "";
  try {
    const body = (await request.json()) as GenerateBody;
    clientRequest = (body?.clientRequest ?? "").trim();

    if (!clientRequest) {
      return NextResponse.json(
        { ok: false, error: "Client request is required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    // No API key configured -> return a graceful fallback (not an error)
    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        source: "fallback",
        reason:
          "OPENAI_API_KEY is not configured. Set it in .env.local locally or in Vercel > Project Settings > Environment Variables.",
        quotation: buildFallbackQuotation(
          clientRequest,
          "OpenAI API key not configured."
        ),
      });
    }

    const client = new OpenAI({ apiKey });

    let lastError: unknown = null;
    for (const model of MODEL_CHAIN) {
      try {
        const response = await client.chat.completions.create({
          model,
          temperature: 0.4,
          max_tokens: 800,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Create a professional draft quotation based on this client request:\n\n${clientRequest}`,
            },
          ],
        });

        const content = response.choices?.[0]?.message?.content?.trim();
        if (content) {
          return NextResponse.json({
            ok: true,
            source: "openai",
            model,
            quotation: content,
          });
        }
      } catch (err) {
        lastError = err;
        // Continue to next model on error
        continue;
      }
    }

    // All models failed -> graceful fallback
    const errMsg =
      lastError instanceof Error ? lastError.message : "Unknown OpenAI error";
    return NextResponse.json({
      ok: true,
      source: "fallback",
      reason: `OpenAI request failed (${errMsg}). Check billing, quota, or model access on platform.openai.com.`,
      quotation: buildFallbackQuotation(clientRequest, errMsg),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    // Even on top-level failure, return a usable fallback so the UI never breaks
    return NextResponse.json({
      ok: true,
      source: "fallback",
      reason: `Server error: ${errMsg}`,
      quotation: buildFallbackQuotation(
        clientRequest || "(no request provided)",
        errMsg
      ),
    });
  }
}
