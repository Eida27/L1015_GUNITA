// Reuse this condition for detail/map/bookmarks/counts and aggregation services.
// statement_timestamp advances on each query even inside a long transaction.
export const publishedPredicate =
  "t.status='published' AND t.expires_at > statement_timestamp()";

export async function findPublishedThought(client, publicId) {
  const { rows } = await client.query(
    `SELECT t.public_id AS "publicId",t.body,t.emotion,p.pseudonym,
    t.location_label AS "locationLabel",ST_X(t.public_point) AS lng,ST_Y(t.public_point) AS lat,
    t.created_at AS "createdAt",t.expires_at AS "expiresAt"
    FROM thoughts t JOIN profiles p ON p.user_id=t.author_id
    WHERE t.public_id=$1 AND ${publishedPredicate}`,
    [publicId],
  );
  return rows[0] || null;
}
