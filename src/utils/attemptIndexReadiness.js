// The old roll-number/slot schema had unique indexes over fields that
// new email-based candidates do not send. MongoDB treats missing fields
// as null in an ordinary unique index and can reject unrelated students.
function isEmailConstraint(index) {
  return index.unique === true &&
    JSON.stringify(index.key) === JSON.stringify({ quiz: 1, email: 1 }) &&
    JSON.stringify(index.partialFilterExpression) ===
      JSON.stringify({ email: { $type: "string" } });
}

export function inspectAttemptIndexes(indexes) {
  const emailUniqueIndexReady = indexes.some(isEmailConstraint);
  const blockingUniqueIndexNames = indexes.filter((index) =>
    index.unique && index.name !== "_id_" && !isEmailConstraint(index)
  ).map((index) => index.name);

  return {
    emailUniqueIndexReady,
    blockingUniqueIndexNames,
    ready: emailUniqueIndexReady && blockingUniqueIndexNames.length === 0,
  };
}

export async function assertAttemptIndexesReady(collection) {
  const state = inspectAttemptIndexes(await collection.indexes());
  if (!state.ready) {
    console.error("Exam attempts index verification failed:", JSON.stringify(state));
    throw new Error(
      "REFUSED: exam attempt indexes are unsafe. " +
      "Run npm run db:migrate:check and follow the verified database migration procedure."
    );
  }
}
