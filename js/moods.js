// Mood categories. Codes must match private.moods in supabase/schema.sql.
export const MOODS = [
  { code: 'happy',      label: 'Happy',      emoji: '😄', valence: 'positive', color: '#6EE7B7' },
  { code: 'loved',      label: 'Loved',      emoji: '🥰', valence: 'positive', color: '#9AF5D2' },
  { code: 'calm',       label: 'Calm',       emoji: '😌', valence: 'positive', color: '#4CC9A4' },
  { code: 'excited',    label: 'Excited',    emoji: '🤩', valence: 'positive', color: '#B6F7A8' },
  { code: 'okay',       label: 'Okay',       emoji: '😐', valence: 'neutral',  color: '#7FA8FF' },
  { code: 'sad',        label: 'Sad',        emoji: '😔', valence: 'negative', color: '#E893A8' },
  { code: 'anxious',    label: 'Anxious',    emoji: '😰', valence: 'negative', color: '#D97B93' },
  { code: 'frustrated', label: 'Frustrated', emoji: '😡', valence: 'negative', color: '#C7667E' },
  { code: 'tired',      label: 'Tired',      emoji: '😴', valence: 'neutral',  color: '#A3B5DA' },
  { code: 'hopeful',    label: 'Hopeful',    emoji: '🤍', valence: 'positive', color: '#D7FFF0' },
];

export const MOOD_BY_CODE = new Map(MOODS.map((m) => [m.code, m]));

export const VALENCE = {
  positive: { label: 'Positive', color: '#6EE7B7' },
  neutral:  { label: 'Neutral',  color: '#7FA8FF' },
  negative: { label: 'Negative', color: '#E893A8' },
};

export const WINDOWS = {
  '1h':  { label: 'Last hour',     ms: 3600e3,      bucketMs: 5 * 60e3 },
  '24h': { label: 'Last 24 hours', ms: 24 * 3600e3, bucketMs: 3600e3 },
  '7d':  { label: 'Last 7 days',   ms: 7 * 864e5,   bucketMs: 6 * 3600e3 },
  '30d': { label: 'Last 30 days',  ms: 30 * 864e5,  bucketMs: 864e5 },
};
