import { Transform, pipeline } from "node:stream";
import { Attempt } from "../models/attempt.model.js";
import { successResponse } from "../utils/responseHandler.js";
import {
  buildResultFilter, resultSummary, RESULTS_FIELDS,
  CSV_HEADERS, csvCell, csvRow,
} from "../utils/resultHelpers.js";

// MongoDB cursor pagination: fetch only 25–100 lightweight documents.
// Sorting by immutable _id (creation order) avoids changing page boundaries
// when an attempt transitions from started to submitted or gets graded.
export const listResults = async (req, res) => {
  const { limit, ...params } = req.validatedQuery;
  const filter = buildResultFilter(params);

  const docs = await Attempt.find(filter)
    .select(RESULTS_FIELDS)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Results fetched", {
    items: page.map(resultSummary),
    nextCursor: hasMore ? String(page.at(-1)._id) : null,
    hasMore,
  });
};

export const resultsStats = async (req, res) => {
  const { quizId, slotId } = req.validatedQuery;
  const filter = buildResultFilter({ quizId, slotId });
  const now = new Date();

  const [stats] = await Attempt.aggregate([
    { $match: filter },
    { $group: {
      _id: null,
      totalAttempts: { $sum: 1 },
      inProgress: { $sum: { $cond: [
        { $and: [{ $eq: ["$status", "started"] }, { $gt: ["$expiresAt", now] }] }, 1, 0,
      ] } },
      expiredPendingFinalization: { $sum: { $cond: [
        { $and: [{ $eq: ["$status", "started"] }, { $lte: ["$expiresAt", now] }] }, 1, 0,
      ] } },
      submitted: { $sum: { $cond: [{ $eq: ["$status", "submitted"] }, 1, 0] } },
      terminated: { $sum: { $cond: [{ $eq: ["$status", "terminated"] }, 1, 0] } },
      pendingManualReview: { $sum: { $cond: [
        { $and: [{ $eq: ["$status", "submitted"] }, { $eq: ["$gradingStatus", "pending_review"] }] }, 1, 0,
      ] } },
      graded: { $sum: { $cond: [
        { $and: [{ $eq: ["$status", "submitted"] }, { $eq: ["$gradingStatus", "graded"] }] }, 1, 0,
      ] } },
    } },
  ]);

  const { _id, ...counts } = stats || {};
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Quiz statistics", Object.keys(counts).length ? counts : {
    totalAttempts: 0, inProgress: 0, expiredPendingFinalization: 0,
    submitted: 0, terminated: 0, pendingManualReview: 0, graded: 0,
  });
};

// Export every matching attempt—not merely the rows currently visible in
// pagination. QueryCursor + pipeline respects stream backpressure.
export const exportResults = (req, res) => {
  const params = req.validatedQuery;
  const filter = buildResultFilter(params);
  const cursor = Attempt.find(filter)
    .select(RESULTS_FIELDS)
    .sort({ _id: -1 })
    .lean()
    .cursor({ batchSize: 100 });

  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="quiz-results-${params.quizId}.csv"`,
    "Cache-Control": "no-store",
  });
  res.write("\ufeff" + CSV_HEADERS.map(csvCell).join(",") + "\r\n");

  const encoder = new Transform({
    writableObjectMode: true,
    transform(doc, _encoding, callback) {
      try { callback(null, csvRow(doc)); }
      catch (error) { callback(error); }
    },
  });

  pipeline(cursor, encoder, res, (error) => {
    if (error && !res.destroyed) {
      // A partially transferred CSV must be treated as failed, never complete.
      console.error("CSV export interrupted");
      res.destroy();
    }
  });
};
