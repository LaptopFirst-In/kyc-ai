import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey! });

export interface ReportData {
  text: string;
  sources: { uri: string; title: string }[];
}

export async function generateOrganizationReport(query: string): Promise<ReportData> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Conduct a detailed due diligence report for the following organization/startup: "${query}".
    
    The report MUST include:
    1. Registered Legal Entity Name (e.g., Private Limited, LLP).
    2. Directors/Partners names.
    3. Registered and Operational Addresses.
    4. Filing history summary (if available, e.g., MCA filings in India).
    5. Detailed description of their product/service.
    6. Reviews and Reputation Analysis:
       - Summarize publicly available reviews and mentions from common search engines (Google, etc.).
       - Search for and summarize ratings/reviews from the Google Play Store and Apple App Store if the organization has mobile applications.
       - Note any significant news or public mentions that might affect vendor risk assessment.
    
    If a GST number is provided, use it to verify the legal entity details.
    Format the output in clear Markdown with sections.
    Use Google Search to find the most recent and accurate information.
  `;

  const response = await ai.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text || "No report generated.";
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk: any) => ({
      uri: chunk.web?.uri || "",
      title: chunk.web?.title || "",
    }))
    .filter((source: any) => source.uri !== "") || [];

  return { text, sources };
}
