import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const API_KEY = process.env.API_KEY ?? "";

export async function POST() {
  const res = await fetch(`${BACKEND_URL}/infer`, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to trigger inference" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
