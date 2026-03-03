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
    `${BACKEND_URL}/actions?zone_id=${zone_id}`,
    {
      headers: { "X-API-Key": API_KEY },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch actions" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
