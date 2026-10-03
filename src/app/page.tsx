import { PrismaClient } from "@prisma/client";
import { format } from "date-fns";
import { ReactNode } from "react";

const prisma = new PrismaClient();

// Helper to determine status color
const StatusBadge = ({ status }: { status: string }) => {
  const isDelivered = status === "delivered";
  const isFailed = status === "failed";
  const isDeferred = status === "deferred";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide shadow-sm border ${
        isDelivered
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
          : isFailed
          ? "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
          : isDeferred
          ? "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
          : "bg-slate-500/10 text-slate-400 border-slate-500/20"
      }`}
    >
      {isDelivered && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2 animate-pulse" />}
      {isFailed && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mr-2" />}
      {isDeferred && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-2" />}
      {status.toUpperCase()}
    </span>
  );
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page as string || "1", 10);
  const q = params.q as string | undefined;
  const hasContent = params.hasContent === "true";
  const perPage = 50;

  const where: any = {};
  if (q) {
    where.content = { subject: { contains: q, mode: "insensitive" } };
  } else if (hasContent) {
    where.content = { isNot: null };
  }

  const logs = await prisma.emailMessage.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: perPage,
    skip: (page - 1) * perPage,
    include: { content: { select: { subject: true } } }
  });

  const total = await prisma.emailMessage.count({ where });
  const deliveredCount = await prisma.emailMessage.count({ where: { status: "delivered" } });
  const failedCount = await prisma.emailMessage.count({ where: { status: "failed" } });
  const deferredCount = await prisma.emailMessage.count({ where: { status: "deferred" } });

  const deliveryRate = total > 0 ? ((deliveredCount / total) * 100).toFixed(1) : "0.0";

  return (
    <main className="min-h-screen bg-[#09090b] text-slate-50 relative overflow-hidden font-sans selection:bg-indigo-500/30">
      {/* Dynamic Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-indigo-500/20 blur-[120px] rounded-full pointer-events-none opacity-50" />
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none opacity-40" />

      <div className="container mx-auto px-4 md:px-8 py-10 relative z-10 max-w-7xl">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 mb-12">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-white to-slate-400 bg-clip-text text-transparent drop-shadow-sm">
              Hostinger Mail Monitor
            </h1>
            <p className="text-slate-400 text-sm md:text-base font-medium max-w-lg">
              Real-time analytics and archival of your outbound delivery logs, secured in your private vault.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-sm font-semibold text-slate-200">Worker Active</span>
            </div>
          </div>
        </header>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
          <StatCard title="Total Processed" value={total.toLocaleString()} icon="📬" />
          <StatCard title="Delivered" value={deliveredCount.toLocaleString()} icon="✅" trend="good" />
          <StatCard title="Failed / Bounced" value={failedCount.toLocaleString()} icon="❌" trend="bad" />
          <StatCard title="Delivery Rate" value={`${deliveryRate}%`} icon="📈" trend="good" />
        </div>

        {/* Table Container (Glassmorphism) */}
        <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden ring-1 ring-white/5">
          <div className="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
            <h2 className="text-lg font-semibold text-white tracking-wide">Recent Deliveries</h2>
            <div className="text-xs font-medium text-slate-400 bg-slate-800/50 px-3 py-1 rounded-md border border-slate-700/50">
              Showing {((page - 1) * perPage) + (logs.length > 0 ? 1 : 0)} - {((page - 1) * perPage) + logs.length}
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-white/[0.02] text-slate-400 font-medium border-b border-white/5">
                <tr>
                  <th className="px-6 py-4 font-semibold tracking-wider">Timestamp</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Sender</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Recipient</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Subject</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Project</th>
                  <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
                  <th className="px-6 py-4 font-semibold tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.03] transition-colors duration-200 group">
                    <td className="px-6 py-4 whitespace-nowrap text-slate-300 font-mono text-xs">
                      {format(log.timestamp, "MMM d, yyyy HH:mm:ss")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="truncate max-w-[180px] text-slate-300 font-medium" title={log.sender}>
                        {log.sender}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="truncate max-w-[180px] inline-block text-slate-300" title={log.recipient}>
                        {log.recipient}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="truncate max-w-[200px] inline-block text-slate-400 text-sm">
                        {log.content?.subject || <span className="italic opacity-50">(no content)</span>}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {log.projectLabel ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                          {log.projectLabel}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs italic">unknown</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <a href={`/emails/${log.id}`} className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors">
                        View &rarr;
                      </a>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="inline-flex flex-col items-center justify-center space-y-3">
                        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                        <p className="text-slate-400 font-medium">Worker is fetching records...</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between bg-white/[0.01]">
            <div className="text-xs text-slate-500">
              Page {page} of {Math.max(1, Math.ceil(total / perPage))}
            </div>
            <div className="flex gap-2">
              {page > 1 && (
                <a href={`/?page=${page - 1}`} className="px-4 py-2 border border-white/10 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all shadow-sm">
                  Previous
                </a>
              )}
              {page * perPage < total && (
                <a href={`/?page=${page + 1}`} className="px-4 py-2 border border-white/10 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium transition-all shadow-sm">
                  Next
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// Simple Stat Card Component
function StatCard({ title, value, icon, trend }: { title: string; value: string; icon: string; trend?: "good" | "bad" }) {
  return (
    <div className="p-6 rounded-2xl bg-black/40 border border-white/10 shadow-xl backdrop-blur-xl relative overflow-hidden group hover:border-white/20 transition-all duration-300">
      <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/[0.02] rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-colors" />
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
          <h3 className="text-3xl font-bold tracking-tight text-white">{value}</h3>
        </div>
        <div className="text-2xl bg-white/5 p-2 rounded-xl border border-white/5">
          {icon}
        </div>
      </div>
      {trend === "good" && <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/50 to-emerald-500/0" />}
      {trend === "bad" && <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500/0 via-rose-500/50 to-rose-500/0" />}
    </div>
  );
}
