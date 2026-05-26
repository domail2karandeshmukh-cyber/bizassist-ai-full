"use client";

import { useState } from "react";
import jsPDF from "jspdf";



type QuoteItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};
type QuoteHistory = {
  id: number;
  request: string;
  total: number;
  date: string;
};

const catalogue = [
  {
    keyword: "laptop",
    name: "Business Laptop",
    unitPrice: 500,
  },
  {
    keyword: "microsoft 365",
    name: "Microsoft 365 Setup",
    unitPrice: 80,
  },
  {
    keyword: "remote support",
    name: "Remote IT Support - 1 Year",
    unitPrice: 2000,
  },
  {
    keyword: "website",
    name: "Website Setup",
    unitPrice: 1500,
  },
  {
    keyword: "cybersecurity",
    name: "Cybersecurity Audit",
    unitPrice: 2500,
  },
];

export default function Home() {
  const [clientRequest, setClientRequest] = useState("");
  const [quotation, setQuotation] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState<QuoteHistory[]>([]);


  function findQuantity(text: string, keyword: string) {
    const lowerText = text.toLowerCase();

    if (keyword === "laptop") {
      const match = lowerText.match(/(\d+)\s*(laptop|laptops)/);
      return match ? Number(match[1]) : 1;
    }

    if (keyword === "microsoft 365") {
      const match = lowerText.match(/(\d+)\s*(user|users|employee|employees)/);
      return match ? Number(match[1]) : 15;
    }

    return 1;
  }

  function generateQuotation() {
    if (!clientRequest.trim()) {
      setQuotation("Please enter a client request first.");
      setItems([]);
      setTotal(0);
      return;
    }

    const lowerRequest = clientRequest.toLowerCase();

    const detectedItems: QuoteItem[] = catalogue
      .filter((product) => {
  if (product.keyword === "remote support") {
    return (
      lowerRequest.includes("remote support") ||
      lowerRequest.includes("remote it support") ||
      lowerRequest.includes("it support")
    );
  }

  return lowerRequest.includes(product.keyword);
})
      .map((product) => {
        const quantity = findQuantity(clientRequest, product.keyword);
        return {
          name: product.name,
          quantity,
          unitPrice: product.unitPrice,
          total: quantity * product.unitPrice,
        };
      });

    if (detectedItems.length === 0) {
      setItems([]);
      setTotal(0);
      setQuotation(
        "No catalogue item was detected. Please mention products such as laptop, Microsoft 365, remote support, website, or cybersecurity."
      );
      return;
    }

    const calculatedTotal = detectedItems.reduce(
      (sum, item) => sum + item.total,
      0
    );

    setItems(detectedItems);
    setTotal(calculatedTotal);
    setHistory((previousHistory) => [
  {
    id: Date.now(),
    request: clientRequest,
    total: calculatedTotal,
    date: new Date().toLocaleString(),
  },
  ...previousHistory,
]);


    const itemLines = detectedItems
      .map(
        (item, index) =>
          `${index + 1}. ${item.name} - Quantity: ${item.quantity} - Unit Price: €${item.unitPrice} - Total: €${item.total}`
      )
      .join("\n");

    setQuotation(`BizAssist AI Solutions
Draft Quotation

Client Request Summary:
${clientRequest}

Detected Requirements:
${itemLines}

Total Estimated Amount: €${calculatedTotal}

Delivery Timeline:
The estimated delivery time is 10 working days after confirmation.

Terms:
- This quotation is generated as a draft by BizAssist AI Assistant.
- Final pricing must be reviewed and approved by a human before sending.
- Taxes and additional service charges may apply.

Email Draft:
Dear Client,

Thank you for your request. Based on your requirements, we prepared a draft quotation. Please review the quotation details below. We will be happy to adjust the offer based on your final needs.

Best regards,
BizAssist AI Solutions`);
  }

  function copyQuotation() {
    if (!quotation) {
      alert("Please generate a quotation first.");
      return;
    }

    navigator.clipboard.writeText(quotation);
    alert("Quotation copied successfully!");
  }
function downloadPDF() {
  if (!quotation) {
    alert("Please generate a quotation first.");
    return;
  }

  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text("BizAssist AI Solutions", 15, 20);

  doc.setFontSize(14);
  doc.text("Draft Quotation", 15, 30);

  doc.setFontSize(10);

  const lines = doc.splitTextToSize(quotation, 180);
  doc.text(lines, 15, 45);

  doc.save("bizassist-draft-quotation.pdf");
}

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-10 text-slate-900">
      <section className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white shadow">
            BA
          </div>
          <div>
            <h1 className="text-4xl font-bold">BizAssist AI Assistant</h1>
            <p className="mt-2 text-slate-600">
              AI quotation assistant for Small and Medium-sized Enterprises
            </p>
          </div>
        </header>

        <section className="mb-6 rounded-2xl bg-white p-6 shadow">
          <h2 className="text-2xl font-semibold">Product Catalogue</h2>
          <p className="mt-2 text-sm text-slate-600">
            The quotation is calculated using this sample catalogue.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-5">
            {catalogue.map((product) => (
              <div
                key={product.name}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <p className="font-semibold">{product.name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  €{product.unitPrice}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-2xl font-semibold">Client Request</h2>
            <p className="mt-2 text-sm text-slate-600">
              Paste the client request below and generate a calculated draft
              quotation.
            </p>

            <textarea
              className="mt-4 h-56 w-full rounded-xl border border-slate-300 p-4 text-sm outline-none focus:border-blue-500"
              placeholder="Example: Hello, we need 15 laptops, Microsoft 365 setup, and one year of remote IT support. Please send us a quotation."
              value={clientRequest}
              onChange={(e) => setClientRequest(e.target.value)}
            />

            <button
              onClick={generateQuotation}
              className="mt-4 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
            >
              Generate Quotation
            </button>
          </section>

          <section className="rounded-2xl border-l-4 border-blue-600 bg-white p-6 shadow">
            <h2 className="text-2xl font-semibold">Generated Quotation</h2>

            {items.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-blue-50 p-4">
                <h3 className="font-semibold">Calculated Items</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {items.map((item) => (
                    <div
                      key={item.name}
                      className="flex justify-between rounded-lg bg-white p-3"
                    >
                      <span>
                        {item.name} × {item.quantity}
                      </span>
                      <span className="font-semibold">€{item.total}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-between rounded-lg bg-blue-600 p-3 text-white">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold">€{total}</span>
                </div>
              </div>
            )}

            <div className="mt-4 min-h-56 whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
              {quotation || "Your quotation will appear here."}
            </div>

            <button
              onClick={copyQuotation}
              className="mt-4 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-700"
            >
              Copy Quotation
            </button>
            <button
  onClick={downloadPDF}
  className="ml-3 mt-4 rounded-xl bg-green-600 px-5 py-3 font-semibold text-white hover:bg-green-700"
>
  Download PDF
</button>

          </section>
        </div>
<section className="mt-8 rounded-2xl bg-white p-6 shadow">
  <h2 className="text-2xl font-semibold">Quotation History</h2>
  <p className="mt-2 text-sm text-slate-600">
    This section shows the quotations generated during the current session.
  </p>

  {history.length === 0 ? (
    <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
      No quotation generated yet.
    </p>
  ) : (
    <div className="mt-4 space-y-3">
      {history.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex justify-between gap-4">
            <div>
              <p className="font-semibold">Quotation #{item.id}</p>
              <p className="mt-1 text-sm text-slate-600">{item.request}</p>
              <p className="mt-1 text-xs text-slate-500">{item.date}</p>
            </div>
            <p className="font-bold text-blue-600">€{item.total}</p>
          </div>
        </div>
      ))}
    </div>
  )}
</section>

        <section className="mt-8 rounded-2xl bg-white p-6 shadow">
          <h2 className="text-2xl font-semibold">About This Full App Version</h2>
          <p className="mt-3 text-slate-600">
            This version is developed using Next.js. It includes a product
            catalogue, automatic quotation calculation, client request analysis,
            and a draft quotation workflow. The next stage is to add PDF export,
            quotation history, Supabase database, login, and real AI API
            integration.
          </p>
        </section>
      </section>
    </main>
  );
}
