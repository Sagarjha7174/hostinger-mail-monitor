import { PrismaClient } from "@prisma/client";
import { format } from "date-fns";
import { decryptBuffer } from "@/lib/content/crypto";
import DOMPurify from "isomorphic-dompurify";
import Link from "next/link";
import { notFound } from "next/navigation";

const prisma = new PrismaClient();

export default async function EmailDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  const log = await prisma.emailMessage.findUnique({
    where: { id },
    include: {
      content: true,
      relayEvents: { orderBy: { position: "asc" } }
    }
  });

  if (!log) notFound();

  let bodyText = "";
  let bodyHtml = "";

  if (log.content) {
    if (log.content.bodyTextEnc) {
      bodyText = decryptBuffer(log.content.bodyTextEnc);
    }
    if (log.content.bodyHtmlEnc) {
      bodyHtml = decryptBuffer(log.content.bodyHtmlEnc);
      // Sanitize HTML server-side
      bodyHtml = DOMPurify.sanitize(bodyHtml, { USE_PROFILES: { html: true } });
    }
  }

  const raw = log.raw as any;

  return (
    <main className="min-h-screen bg-[#09090b] text-slate-50 font-sans selection:bg-indigo-500/30 p-8">
      <div className="max-w-5xl mx-auto">
        <Link href="/" className="inline-block mb-6 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors">
          &larr; Back to Dashboard
        </Link>
        
        <h1 className="text-3xl font-bold mb-8">Email Details</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Metadata & Envelope */}
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-black/40 border border-white/10 shadow-xl backdrop-blur-xl">
              <h2 className="text-xl font-semibold mb-4 text-white">Envelope</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-slate-400">Timestamp</dt>
                  <dd className="font-mono text-slate-200">{format(log.timestamp, "MMM d, yyyy HH:mm:ss")}</dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-slate-400">Sender</dt>
                  <dd className="text-slate-200">{log.sender}</dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-slate-400">Recipient</dt>
                  <dd className="text-slate-200">{log.recipient}</dd>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <dt className="text-slate-400">Status</dt>
                  <dd className="text-slate-200 uppercase font-semibold text-emerald-400">{log.status}</dd>
                </div>
                <div className="flex justify-between pb-2">
                  <dt className="text-slate-400">Client IP</dt>
                  <dd className="text-slate-200">{log.clientIp}</dd>
                </div>
              </dl>
            </div>

            <div className="p-6 rounded-2xl bg-black/40 border border-white/10 shadow-xl backdrop-blur-xl">
              <h2 className="text-xl font-semibold mb-4 text-white">Relay Events</h2>
              {log.relayEvents.length > 0 ? (
                <div className="space-y-4">
                  {log.relayEvents.map((evt, idx) => (
                    <div key={idx} className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-400 mb-1">{format(evt.eventTime, "HH:mm:ss")} - {evt.relay}</div>
                      <div className="font-mono text-sm text-amber-200/90">{evt.response}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 italic">No relay events recorded.</p>
              )}
            </div>
          </div>

          {/* Right Column: Content */}
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-black/40 border border-white/10 shadow-xl backdrop-blur-xl h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Captured Content</h2>
                {log.content && (
                  <span className="px-2 py-1 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs rounded-full font-medium">
                    {log.content.matchConfidence} match
                  </span>
                )}
              </div>
              
              {log.content ? (
                <div className="flex flex-col flex-1">
                  <div className="mb-4">
                    <label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Subject</label>
                    <div className="text-lg font-medium text-white">{log.content.subject}</div>
                  </div>
                  
                  <div className="flex-1 bg-white rounded-lg overflow-hidden border border-slate-200 min-h-[300px] relative">
                    {bodyHtml ? (
                      <iframe 
                        sandbox="" 
                        srcDoc={bodyHtml}
                        className="w-full h-full absolute inset-0 bg-white"
                        title="Email Body HTML"
                      />
                    ) : (
                      <div className="p-4 text-slate-800 whitespace-pre-wrap font-sans">
                        {bodyText || <span className="text-slate-400 italic">No text content available.</span>}
                      </div>
                    )}
                  </div>
                  
                  {log.content.attachments && Array.isArray(log.content.attachments) && log.content.attachments.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <label className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-2 block">Attachments</label>
                      <div className="flex flex-wrap gap-2">
                        {log.content.attachments.map((att: any, idx: number) => (
                          <span key={idx} className="text-xs bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-300">
                            📎 {att.name} ({(att.size / 1024).toFixed(1)} KB)
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <span className="text-4xl mb-4 opacity-50">📭</span>
                  <h3 className="text-lg font-medium text-slate-300 mb-2">No Content Captured</h3>
                  <p className="text-sm text-slate-500 max-w-xs">
                    This log was received from Hostinger, but no corresponding email body was securely archived by the proxy.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
