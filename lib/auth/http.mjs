import { authService, authFailure } from './server.mjs';
import { assertOrigin } from './core.mjs';
import { readPlanningJson } from '../planning/http.mjs';
export function authHandlers(service = authService, env = process.env) {
  return {
    async login(request) {
      try {
        assertOrigin(request, env);
        const cookie = await service().login(request, await readPlanningJson(request));
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
      } catch (error) { return authFailure(error); }
    },
    async logout(request) {
      try {
        assertOrigin(request, env);
        const cookie = await service().logout(request);
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
      } catch (error) { return authFailure(error); }
    }
  };
}
