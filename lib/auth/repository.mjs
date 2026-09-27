export function authRepository(db) {
  return {
    async consumeLoginAttempt() {
      const result = await db.query(`INSERT INTO app_login_limits AS l(bucket,window_started_at,attempts)
        VALUES ('single-user',clock_timestamp(),1)
        ON CONFLICT (bucket) DO UPDATE SET
          attempts=CASE WHEN l.window_started_at <= clock_timestamp()-interval '15 minutes' THEN 1 ELSE l.attempts+1 END,
          window_started_at=CASE WHEN l.window_started_at <= clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE l.window_started_at END
        WHERE l.window_started_at <= clock_timestamp()-interval '15 minutes' OR l.attempts < 10
        RETURNING attempts`);
      return result.rows.length > 0;
    },
    async replaceSession(previousHash, hash, version) {
      await db.transaction(async client => {
        await client.query('DELETE FROM app_sessions WHERE expires_at <= clock_timestamp() OR token_hash=$1 OR credential_version<>$2', [previousHash, version]);
        await client.query(`INSERT INTO app_sessions(token_hash,credential_version,expires_at) VALUES ($1,$2,clock_timestamp()+interval '8 hours')`, [hash, version]);
      });
    },
    async validSession(hash, version) {
      return (await db.query('SELECT 1 FROM app_sessions WHERE token_hash=$1 AND credential_version=$2 AND expires_at>clock_timestamp()', [hash, version])).rows.length > 0;
    },
    async revoke(hash) { await db.query('DELETE FROM app_sessions WHERE token_hash=$1', [hash]); }
  };
}
