// Real automation is not exposed by the phase-2B web application.
export const runtime = 'nodejs';
export async function POST() {
  return Response.json({ ok: false, code: 'WORKER_INACTIVE', message: 'Manuelle ERGO-Aktionen sind in der Web-App deaktiviert.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
}
