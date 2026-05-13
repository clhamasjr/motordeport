import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-2xl space-y-6 text-center">
        <div className="flex items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-3xl">
            ⚡
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight">FlowForce V2</h1>
            <p className="text-sm text-muted-foreground">Plataforma de crédito · LhamasCred</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-3 text-left">
          <h2 className="font-bold flex items-center gap-2">
            🚧 <span>Em construção</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Versão V2 do FlowForce está sendo migrada do JavaScript vanilla pra Next.js + React + TanStack Query + Supabase Realtime.
            Operação atual continua em <span className="text-primary">motordeport.vercel.app</span>.
          </p>
          <div className="text-sm space-y-1 mt-4">
            <p>✅ Setup base (Next.js + Tailwind + shadcn/ui)</p>
            <p>⏳ Auth/login</p>
            <p>⏳ Consulta CLT</p>
            <p>⏳ Esteira / Empresas Aprovadas</p>
            <p>⏳ INSS</p>
            <p>⏳ Governos / Prefeituras / SIAPE</p>
          </div>
        </div>

        <div className="flex gap-3 justify-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Entrar
          </Link>
          <a
            href="https://motordeport.vercel.app"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-secondary"
          >
            Sistema V1
          </a>
        </div>
      </div>
    </div>
  );
}
