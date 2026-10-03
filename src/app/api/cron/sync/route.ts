import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync/runner";
import { matchUnlinkedContent } from "@/lib/content/matcher";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    // Run incremental sync directly in the API route
    await runSync("incremental", 2);
    
    // Also run the matcher just in case proxy content is waiting
    await matchUnlinkedContent();

    return NextResponse.json({ success: true, message: "Sync completed successfully" });
  } catch (error) {
    console.error("[Cron Sync Error]", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
