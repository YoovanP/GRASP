import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const API_KEY = process.env.API_KEY ?? "";

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/stress/latest`, {
    headers: { "X-API-Key": API_KEY },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch latest stress readings" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
