/**
 * bandScore.js
 * ------------
 * Converts an IELTS raw score (0-40 correct answers) into the official band
 * score, per the fixed conversion table below. The published conversion
 * table is the same for Academic Reading and Listening (both out of 40),
 * so this one table covers both — see routes/submissions.js's POST
 * handler, which calls this for either module.
 */
const BAND_TABLE = [
  { min: 39, max: 40, band: 9 },
  { min: 37, max: 38, band: 8.5 },
  { min: 35, max: 36, band: 8 },
  { min: 33, max: 34, band: 7.5 },
  { min: 30, max: 32, band: 7 },
  { min: 27, max: 29, band: 6.5 },
  { min: 23, max: 26, band: 6 },
  { min: 19, max: 22, band: 5.5 },
  { min: 15, max: 18, band: 5 },
  { min: 13, max: 14, band: 4.5 },
  { min: 10, max: 12, band: 4 },
  { min: 8, max: 9, band: 3.5 },
  { min: 6, max: 7, band: 3 },
  { min: 4, max: 5, band: 2.5 },
  { min: 0, max: 3, band: 0 }, // Unscored
];

/**
 * @param {number} rawScore - number of correct answers (0-40)
 * @returns {number} the corresponding IELTS band score
 */
function getBandScore(rawScore) {
  const score = Math.max(0, Math.min(40, Math.round(Number(rawScore) || 0)));
  const entry = BAND_TABLE.find((e) => score >= e.min && score <= e.max);
  return entry ? entry.band : 0;
}

module.exports = { getBandScore, BAND_TABLE };
