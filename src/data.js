export const INITIAL_CIRCLES = [
  { id: "close", name: "Close Friends" },
  { id: "family", name: "Family" },
];

export const INITIAL_POSTS = [
  {
    id: "p3", author: "You", mine: true, createdAt: Date.now() - 7_200_000, audience: "close",
    text: "Said “we should hang out” to four different people this month. Hung out with zero of them.",
    reactions: { heart: { count: 3, mine: false }, laugh: { count: 2, mine: false } },
    comments: [
      { id: "c1", author: "Priya", text: "in this economy? unrealistic" },
      { id: "c2", author: "Dev", text: "callout post for me specifically" },
    ],
  },
  {
    id: "p2c", author: "You", mine: true, createdAt: Date.now() - 10_800_000, audience: "family",
    text: "Reminder that I'm bringing the good potato salad to Sunday dinner, not the store one from last time.",
    reactions: { heart: { count: 2, mine: false }, laugh: { count: 0, mine: false } }, comments: [],
  },
  {
    id: "p2b", author: "You", mine: true, createdAt: Date.now() - 14_400_000, audience: "private",
    text: "Note to self: stop checking if he read the message. He read the message.",
    reactions: { heart: { count: 0, mine: false }, laugh: { count: 0, mine: false } }, comments: [],
  },
  {
    id: "p2", author: "Marcus", mine: false, createdAt: Date.now() - 21_600_000, audience: "everyone",
    text: "The grocery store started playing early 2000s pop and I stood in the cereal aisle way too long.",
    reactions: { heart: { count: 5, mine: true }, laugh: { count: 1, mine: false } },
    comments: [{ id: "c3", author: "You", text: "which store, I need this in my life" }],
  },
  {
    id: "p1", author: "Priya", mine: false, createdAt: Date.now() - 86_400_000, audience: "everyone",
    text: "My cat sat on my keyboard and somehow bought a $40 candle. No regrets.",
    reactions: { heart: { count: 8, mine: false }, laugh: { count: 6, mine: true } }, comments: [],
  },
];
