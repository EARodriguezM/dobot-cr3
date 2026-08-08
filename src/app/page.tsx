export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Laboratorio remoto
      </p>
      <h1 className="font-head text-5xl font-extrabold tracking-tight">
        PRIM<span className="text-accent">BIO</span> Lab
      </h1>
      <p className="max-w-md text-ink3">
        Plantilla base de laboratorio remoto — autenticación, panel de control y
        telemetría se integran en las siguientes fases.
      </p>
    </main>
  );
}
