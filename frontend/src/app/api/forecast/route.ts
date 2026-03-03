import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const API_KEY = process.env.API_KEY ?? "";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zone_id = searchParams.get("zone_id");

  if (!zone_id) {
    return NextResponse.json({ error: "zone_id is required" }, { status: 400 });
  }

  const res = await fetch(
    `${BACKEND_URL}/forecast?zone_id=${zone_id}`,
    {
      headers: { "X-API-Key": API_KEY },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text();                          // ← add
    console.error("Forecast error:", res.status, body);    // ← add
    return NextResponse.json(
      { error: "Failed to fetch forecast", detail: body }, // ← add detail
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
