export async function bootstrapAdmin(client, email, confirmation) {
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !email.includes('@') ||
    confirmation !== email
  )
    throw new Error('Exact email confirmation required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    // Privilege check also makes already-promoted idempotence unavailable to web.
    if (
      !(
        await client.query(
          "SELECT has_column_privilege(current_user,'profiles','role','UPDATE') allowed",
        )
      ).rows[0].allowed
    )
      throw new Error('Operator credentials required');
    const user = (
      await client.query(
        'SELECT id,email_verified FROM "user" WHERE email=$1 FOR UPDATE',
        [email],
      )
    ).rows[0];
    if (!user?.email_verified)
      throw new Error('Eligible verified account required');
    const profile = (
      await client.query(
        'SELECT role,status FROM profiles WHERE user_id=$1 FOR UPDATE',
        [user.id],
      )
    ).rows[0];
    if (profile?.status !== 'active')
      throw new Error('Eligible verified account required');
    if (profile.role !== 'admin') {
      await client.query(
        "UPDATE profiles SET role='admin',updated_at=statement_timestamp() WHERE user_id=$1",
        [user.id],
      );
      await client.query(
        "INSERT INTO admin_audit(action,subject_kind,subject_user_id,reason_code,changed_status) VALUES('bootstrap_admin','account',$1,'OPERATOR_CONFIRMED','admin')",
        [user.id],
      );
    }
    await client.query('COMMIT');
    return { status: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
