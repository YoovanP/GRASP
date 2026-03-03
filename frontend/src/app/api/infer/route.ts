import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const API_KEY = process.env.API_KEY ?? "";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const res = await fetch(`${BACKEND_URL}/infer`, {
      method: "POST",
      headers: { 
        "X-API-Key": API_KEY,
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: "Failed to trigger inference", detail },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Fetch failed", detail: String(err) },
      { status: 500 }
    );
  }
}